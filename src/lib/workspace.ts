import { demoRepo, DEMO_COMMIT, DEMO_REPO_URL, DEMO_BRANCH } from "./fixtures/demo-repo";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const exec = promisify(execFile);

export type Workspace = {
  url: string;
  branch: string;
  commit: string;
  /** path -> isi file. Foto repo tidak ;; idealnya < 2 MB. */
  files: Record<string, string>;
  bytes: number;
};

const IGNORE = /(node_modules|\.git\/|dist\/|build\/|\.next\/|coverage\/|reports\/)/;
const MAX_FILES = 4000;
const MAX_BYTES = 8 * 1024 * 1024;

export function workspaceBytes(files: Record<string, string>): number {
  return Object.values(files).reduce((a, s) => a + Buffer.byteLength(s), 0);
}

/**
 * GIT_PROVIDER=github → `git clone --depth 1` sungguhan (butuh git di PATH).
 * GIT_PROVIDER=mock   → fixture lokal (tanpa jaringan, jalan di serverless).
 * Tidak ada dependency git library: git CLI cukup, dan kegagalan dikembalikan sebagai pesan jelas.
 */
export async function cloneRepo(input: {
  url: string; branch: string; subfolder?: string | null; token?: string;
}): Promise<Workspace> {
  const provider = process.env.GIT_PROVIDER ?? "mock";
  const isLocal = input.url.startsWith("file://") || input.url.startsWith("/");

  if (provider === "github" || isLocal) {
    const dir = await mkdtemp(join(tmpdir(), "veriflow-clone-"));
    try {
      const url = isLocal ? input.url.replace("file://", "") : withToken(input.url, input.token);
      await exec("git", ["clone", "--depth", "1", "--single-branch", "--branch", input.branch || "main", url, dir], {
        timeout: 120_000, maxBuffer: 1 << 24,
      });
      const commit = (await exec("git", ["-C", dir, "rev-parse", "HEAD"])).stdout.trim();
      const files = await walk(dir, input.subfolder ?? null);
      return { url: input.url, branch: input.branch, commit, files: files.files, bytes: files.bytes };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const files = demoRepo();
  return {
    url: input.url || DEMO_REPO_URL,
    branch: input.branch || DEMO_BRANCH,
    commit: DEMO_COMMIT,
    files,
    bytes: workspaceBytes(files),
  };
}

function withToken(url: string, token?: string): string {
  if (!token || !/^https:\/\//.test(url)) return url;
  return url.replace("https://", `https://x-access-token:${token}@`);
}

async function walk(root: string, subfolder: string | null) {
  const base = subfolder ? join(root, subfolder) : root;
  const files: Record<string, string> = {};
  let bytes = 0;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      const rel = relative(base, p);
      if (IGNORE.test(rel) || entry.name.startsWith(".veriflow")) continue;
      if (entry.isDirectory()) { stack.push(p); continue; }
      if (Object.keys(files).length >= MAX_FILES) continue;
      const s = await stat(p);
      if (s.size > 512 * 1024) continue;
      bytes += s.size;
      if (bytes > MAX_BYTES) continue;
      files[rel] = await readFile(p, "utf8");
    }
  }
  return { files, bytes };
}

export const diffPatch = (ws: Workspace, added: Record<string, string>): string => {
  const lines: string[] = [`# Veriflow — generated test framework`, ``, `Repo: ${ws.url}`, `Commit: ${ws.commit}`, ``];
  for (const [path, content] of Object.entries(added)) {
    lines.push(`--- /dev/null`, `+++ b/${path}`, `@@ -0,0 +1,${content.split("\n").length} @@`);
    for (const l of content.split("\n")) lines.push(`+${l}`);
  }
  return lines.join("\n");
};

export const shortSha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 40);