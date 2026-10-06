import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./db";

export type PromptFile = { name: string; version: string; stage: string; hash: string; body: string };

const STAGE: Record<string, string> = {
  "v1-analyzer": "analyze",
  "v2-generator": "generate",
  "v3-healer": "heal",
  "v4-planner": "plan",
  "v5-architecture-summary": "diagram-summary",
  "v6-diagram-labeler": "diagram-label",
  "v7-coverage-gap-planner": "coverage-gap",
  "v8-summarizer": "report-summary",
};

/**
 * Baca prompt pack dari folder `prompts/`.
 * Gagal baca (mis. pada Vercel tanpa repo) -> array kosong; UI menampilkan
 * fallback yang menunjuk lokasi folder. Tidak pernah exception.
 */
export async function readPrompts(): Promise<PromptFile[]> {
  try {
    const dir = resolve(process.cwd(), "prompts");
    const files = await readdir(dir);
    const out: PromptFile[] = [];
    for (const f of files.filter((x) => x.endsWith(".md")).sort()) {
      const body = await readFile(resolve(dir, f), "utf8");
      const stem = f.replace(/\.md$/, "");
      const version = stem.split("-")[0];
      out.push({ name: stem, version, stage: STAGE[stem] ?? "custom", hash: sha256(body).slice(0, 10), body });
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadPrompt(name: string): Promise<{ body: string; version: string; hash: string } | null> {
  const all_ = await readPrompts();
  const p = all_.find((x) => x.name === name);
  return p ? { body: p.body, version: p.version, hash: p.hash } : null;
}

/** Render variabel {{x}} — cukup untuk kebutuhan saat ini, bukan template engine. */
export function render(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(vars[k] ?? `{{${k}}}`));
}