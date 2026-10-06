#!/usr/bin/env node
/**
 * Veriflow Real Runner — pulls shards from API, runs Playwright, pushes results back.
 * Contract: GET /api/v1/internals/results?run_id=  →  POST /api/v1/internals/results
 * Auth: RUNNER_CALLBACK_SECRET (HMAC-SHA256 of payload)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const API_BASE = process.env.VERIFLOW_API_BASE ?? "http://localhost:3000";
const SECRET = process.env.RUNNER_CALLBACK_SECRET;
const POLL_MS = Number(process.env.RUNNER_POLL_MS ?? "5000");
const MAX_SHARD_MS = Number(process.env.RUNNER_MAX_SHARD_MS ?? "300000");
const WORK_DIR = process.env.RUNNER_WORK_DIR ?? "/tmp/veriflow-runs";

if (!SECRET) {
  console.error("[runner] RUNNER_CALLBACK_SECRET not set — exiting");
  process.exit(1);
}

function hmac(payload) {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

async function httpGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} ${res.status}`);
  return res.json();
}

async function httpPost(url, body) {
  const payload = JSON.stringify(body);
  const sig = hmac(payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-veriflow-signature": sig },
    body: payload,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`POST ${url} ${res.status}: ${txt}`);
  }
  return res.json();
}

async function pollOnce(runId) {
  const data = await httpGet(`${API_BASE}/api/v1/internals/results?run_id=${runId}`);
  if (!data.shard) return null;
  return data;
}

async function runShard(runId, shard) {
  const { index, total, testIds, estimatedMs, projectRepoUrl, commitSha, baseUrl, env } = shard;
  console.log(`[runner] run=${runId} shard=${index}/${total} tests=${testIds.length} est=${estimatedMs}ms`);

  const repoDir = path.join(WORK_DIR, runId, `shard-${index}`);
  await fs.mkdir(repoDir, { recursive: true });

  // Shallow clone (or reuse if exists)
  if (!(await fs.stat(path.join(repoDir, ".git")).catch(() => false))) {
    await runCmd("git", ["clone", "--depth", "1", "--branch", shard.branch ?? "main", projectRepoUrl, repoDir]);
  } else {
    await runCmd("git", ["-C", repoDir, "fetch", "--depth", "1", "origin", shard.branch ?? "main"]);
    await runCmd("git", ["-C", repoDir, "reset", "--hard", `origin/${shard.branch ?? "main"}`]);
  }
  await runCmd("git", ["-C", repoDir, "checkout", commitSha]);

  // Install deps (cache node_modules per commit)
  await runCmd("npm", ["ci", "--prefer-offline"], { cwd: repoDir });

  // Write test list file for Playwright --grep
  const testListPath = path.join(repoDir, "veriflow-shard-tests.txt");
  await fs.writeFile(testListPath, testIds.join("\n"), "utf8");

  // Run Playwright with sharding
  const pwArgs = [
    "test",
    `--shard=${index + 1}/${total}`,
    `--reporter=line`,
    `--output=veriflow-results`,
    `--grep-invert`, "@skip",
    `--project=chromium`,
  ];
  if (testIds.length) {
    pwArgs.push(`--grep`, `@veriflow-id:(${testIds.join("|")})`);
  }

  const start = Date.now();
  let status = "passed";
  let output = "";
  let error = null;

  try {
    await runCmd("npx", ["playwright", ...pwArgs], { cwd: repoDir, timeout: MAX_SHARD_MS });
  } catch (e) {
    status = "failed";
    error = String(e);
    output = e.stdout ?? e.stderr ?? "";
  }

  // Parse results from Playwright JSON output
  const resultsPath = path.join(repoDir, "veriflow-results", "results.json");
  let results = [];
  try {
    const raw = await fs.readFile(resultsPath, "utf8");
    results = JSON.parse(raw).suites?.flatMap((s) =>
      s.specs?.flatMap((sp) =>
        sp.tests?.map((t) => ({
          testId: t.title,
          title: t.title,
          file: sp.file,
          status: t.outcome,
          duration_ms: t.duration,
          retries: t.retry,
          error_message: t.errors?.[0]?.message ?? null,
        })) ?? []
      ) ?? []
    ) ?? [];
  } catch {
    // fallback: synthesize from testIds
    results = testIds.map((id) => ({
      testId: id,
      title: id,
      file: "unknown",
      status: status === "passed" ? "passed" : "failed",
      duration_ms: Date.now() - start,
      retries: 0,
      error_message: error,
    }));
  }

  return { runId, shardIndex: index, status, results, durationMs: Date.now() - start };
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], shell: true });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGKILL"), opts.timeout) : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(`${cmd} ${args.join(" ")} exited ${code}`), { stdout, stderr, code }));
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    once: args.includes("--once"),
    runId: args.find((a) => a.startsWith("--run-id="))?.split("=")[1],
  };
}

async function main() {
  const { once, runId } = parseArgs();
  console.log(`[runner] starting — polling ${API_BASE} every ${POLL_MS}ms${once ? " (once mode)" : ""}${runId ? ` target=${runId}` : ""}`);

  if (once && runId) {
    const shard = await pollOnce(runId);
    if (shard) {
      const result = await runShard(runId, shard);
      await httpPost(`${API_BASE}/api/v1/internals/results`, result);
      console.log(`[runner] run=${runId} shard=${shard.index} ${result.status} (${result.results.length} tests)`);
    }
    return;
  }

  while (true) {
    try {
      const runs = await httpGet(`${API_BASE}/api/v1/internals/results?list=executing`);
      for (const run of runs ?? []) {
        const shard = await pollOnce(run.id);
        if (!shard) continue;
        const result = await runShard(run.id, shard);
        await httpPost(`${API_BASE}/api/v1/internals/results`, result);
        console.log(`[runner] run=${run.id} shard=${shard.index} ${result.status} (${result.results.length} tests)`);
      }
    } catch (e) {
      console.error("[runner] loop error:", e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => { console.error("[runner] fatal:", e); process.exit(1); });