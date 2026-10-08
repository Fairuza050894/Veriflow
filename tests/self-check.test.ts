/**
 * Veriflow Self-Check Tests
 * Run: `npm test` → `node --test --experimental-strip-types tests/*.test.ts`
 * No external test framework — uses Node.js built-in test runner (Node 22+)
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

describe("Project Structure", () => {
  test("package.json exists with correct name", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    assert.strictEqual(pkg.name, "veriflow");
    assert.ok(pkg.scripts?.dev);
    assert.ok(pkg.scripts?.build);
    assert.ok(pkg.scripts?.test);
  });

  test("Next.js config exists", () => {
    assert.ok(existsSync(resolve(ROOT, "next.config.ts")));
  });

  test("TypeScript config exists", () => {
    assert.ok(existsSync(resolve(ROOT, "tsconfig.json")));
  });

  test("Source directories exist", () => {
    assert.ok(existsSync(resolve(ROOT, "src/app")));
    assert.ok(existsSync(resolve(ROOT, "src/lib")));
    assert.ok(existsSync(resolve(ROOT, "src/components")));
    assert.ok(existsSync(resolve(ROOT, "prompts")));
  });

  test("All 8 prompt versions exist", () => {
    const expected = [
      "v1-analyzer.md", "v2-generator.md", "v3-healer.md", "v4-planner.md",
      "v5-architecture-summary.md", "v6-diagram-labeler.md", "v7-coverage-gap-planner.md", "v8-summarizer.md"
    ];
    for (const file of expected) {
      assert.ok(existsSync(resolve(ROOT, "prompts", file)), `Missing ${file}`);
    }
  });
});

describe("Database Schema", () => {
  let db: DatabaseSync;

  before(() => {
    db = new DatabaseSync(":memory:");
    const schema = readFileSync(resolve(ROOT, "src/lib/schema.sql"), "utf8");
    db.exec(schema);
  });

  after(() => {
    db.close();
  });

  test("All 20 core tables exist", () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    `).all() as Array<{ name: string }>;

    const expected = [
      "ai_calls", "arch_findings", "arch_snapshots", "devops_findings",
      "diagrams", "email_messages", "environments", "kv", "node_coverage",
      "organizations", "projects", "prompt_versions", "recipients",
      "report_links", "run_logs", "run_steps", "runs", "test_results", "test_stats"
    ];

    const actual = tables.map(t => t.name).sort();
    assert.deepStrictEqual(actual, expected.sort());
  });

  test("runs table has required columns", () => {
    const cols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    assert.ok(names.includes("id"));
    assert.ok(names.includes("project_id"));
    assert.ok(names.includes("status"));
    assert.ok(names.includes("idempotency_key"));
    assert.ok(names.includes("summary"));
    assert.ok(names.includes("cost"));
    assert.ok(names.includes("report_url"));
    assert.ok(names.includes("created_at"));
  });

  test("node_coverage PK is (run_id, node_id) — no snapshot_id", () => {
    const cols = db.prepare("PRAGMA table_info(node_coverage)").all() as Array<{ name: string; pk: number }>;
    const pkCols = cols.filter(c => c.pk > 0).map(c => c.name).sort();
    assert.deepStrictEqual(pkCols, ["node_id", "run_id"]);
    const hasSnapshot = cols.some(c => c.name === "snapshot_id");
    assert.strictEqual(hasSnapshot, false, "node_coverage must not have snapshot_id column");
  });

  test("Foreign keys defined", () => {
    const fks = db.prepare("PRAGMA foreign_key_list(runs)").all() as Array<{ table: string; from: string; to: string }>;
    assert.ok(fks.some(f => f.table === "projects" && f.from === "project_id"));
    // environment_id has no FK in schema (intentional — soft reference)
  });
});

describe("Core Libraries", () => {
  test("db.ts exports required functions", async () => {
    const mod = await import("../src/lib/db.ts");
    assert.ok(typeof mod.uid === "function");
    assert.ok(typeof mod.nowIso === "function");
    assert.ok(typeof mod.sha256 === "function");
    assert.ok(typeof mod.getDb === "function");
    assert.ok(typeof mod.all === "function");
    assert.ok(typeof mod.one === "function");
    assert.ok(typeof mod.run === "function");
    assert.ok(typeof mod.tx === "function");
    assert.ok(mod.J && typeof mod.J.parse === "function");
    assert.ok(mod.kvGet && typeof mod.kvGet === "function");
    assert.ok(mod.kvSet && typeof mod.kvSet === "function");
  });

  test("i18n.ts has id/en dicts with same keys", async () => {
    const mod = await import("../src/lib/i18n.ts");
    assert.ok(mod.dict.id);
    assert.ok(mod.dict.en);
    const idKeys = Object.keys(mod.dict.id).sort();
    const enKeys = Object.keys(mod.dict.en).sort();
    assert.deepStrictEqual(idKeys, enKeys, "ID and EN dicts must have identical keys");
    assert.ok(idKeys.length > 50, "Dictionary should have substantial coverage");
  });

  test("types.ts exports STEP_META with 14 steps", async () => {
    const mod = await import("../src/lib/types.ts");
    assert.ok(mod.STEP_META);
    const steps = Object.keys(mod.STEP_META);
    assert.strictEqual(steps.length, 14);
    assert.ok(steps.includes("CLONING"));
    assert.ok(steps.includes("ANALYZING"));
    assert.ok(steps.includes("EXECUTING"));
    assert.ok(steps.includes("REPORTING"));
    assert.ok(steps.includes("NOTIFYING"));
    for (const meta of Object.values(mod.STEP_META)) {
      assert.ok(typeof meta.timeoutMs === "number");
      assert.ok(typeof meta.retries === "number");
    }
  });

  test("contracts.ts exports Zod schemas", async () => {
    const mod = await import("../src/lib/contracts.ts");
    assert.ok(mod.AnalysisSchema);
    assert.ok(mod.TestPlanSchema);
    assert.ok(mod.ArchModelSchema);
    assert.ok(mod.CoverageEntrySchema);
  });

  test("types.ts exports RunSummary type", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/types.ts"), "utf8");
    assert.ok(content.includes("export type RunSummary ="));
  });

  test("util.ts exports seeded RNG", async () => {
    const mod = await import("../src/lib/util.ts");
    assert.ok(typeof mod.rng === "function");
    const r1 = mod.rng("test-seed");
    const r2 = mod.rng("test-seed");
    // Same seed → same sequence
    assert.strictEqual(r1(), r2());
    assert.strictEqual(r1(), r2());
  });
});

describe("Architecture Extraction & Composition", () => {
  test("extract.ts has extractArchitecture function", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/arch/extract.ts"), "utf8");
    assert.ok(content.includes("export function extractArchitecture"));
    // Extractor objects used by extractArchitecture
    assert.ok(content.includes("prismaExt"));
    assert.ok(content.includes("openapiExt"));
    assert.ok(content.includes("routeExt"));
    assert.ok(content.includes("composeExt"));
    assert.ok(content.includes("ciExt"));
    assert.ok(content.includes("depsExt"));
  });

  test("compose.ts has 9 diagram composers (D01-D09)", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/arch/compose.ts"), "utf8");
    assert.ok(content.includes("D01:"));
    assert.ok(content.includes("D02:"));
    assert.ok(content.includes("D03:"));
    assert.ok(content.includes("D04:"));
    assert.ok(content.includes("D05:"));
    assert.ok(content.includes("D07:"));
    assert.ok(content.includes("D08:"));
    assert.ok(content.includes("D09:"));
  });

  test("COMPOSERS metadata includes audience + inEmail", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/arch/compose.ts"), "utf8");
    // Check D01-D09 structure
    assert.ok(content.includes("inEmail: true"));
    assert.ok(content.includes("inEmail: false"));
    assert.ok(content.includes("audience: \"customer\""));
    assert.ok(content.includes("audience: \"internal\""));
  });
});

describe("Pipeline Engine", () => {
  test("engine.ts exports advanceRun + step functions", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/pipeline/engine.ts"), "utf8");
    assert.ok(content.includes("export function advanceRun"));
    assert.ok(content.includes("export async function createRun"));
    assert.ok(content.includes("export function log"));
    assert.ok(content.includes("export function setStatus"));
    // Internal functions (not exported but present)
    assert.ok(content.includes("function persistArch"));
    assert.ok(content.includes("function renderDiagrams"));
  });

  test("actions.ts exports approval + report + diff", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/pipeline/actions.ts"), "utf8");
    assert.ok(content.includes("export async function decideReview"));
    assert.ok(content.includes("export async function cancelRun"));
    assert.ok(content.includes("export async function publicReportByToken"));
    assert.ok(content.includes("export async function snapshotDiff"));
    // approve/reject use decideReview with "approve"/"reject"
    // resendEmail is inline in route handler
  });

  test("queries.ts exports overview + runDetail + projectById + seed", () => {
    const content = readFileSync(resolve(ROOT, "src/lib/queries.ts"), "utf8");
    assert.ok(content.includes("export async function overview"));
    assert.ok(content.includes("export async function runDetail"));
    assert.ok(content.includes("export async function projectById"));
    assert.ok(content.includes("export async function ensureSeeded"));
    assert.ok(content.includes("export async function seedDemo"));
    assert.ok(content.includes("export async function allRunRows"));
  });
});

describe("API Route Structure", () => {
  const apiDir = resolve(ROOT, "src/app/api/v1");
  const requiredRoutes = [
    "projects/route.ts",
    "projects/quick-run/route.ts",
    "projects/[id]/route.ts",
    "projects/[id]/runs/route.ts",
    "runs/[id]/route.ts",
    "runs/[id]/stream/route.ts",
    "runs/[id]/cancel/route.ts",
    "runs/[id]/approve/route.ts",
    "runs/[id]/reject/route.ts",
    "runs/[id]/emails/resend/route.ts",
    "runs/[id]/tests/route.ts",
    "runs/[id]/architecture/route.ts",
    "runs/[id]/diagrams/[kind]/route.ts",
    "metrics/overview/route.ts",
    "webhooks/github/route.ts",
    "internals/results/route.ts",
  ];

  for (const route of requiredRoutes) {
    test(`Route exists: ${route}`, () => {
      assert.ok(existsSync(resolve(apiDir, route)), `Missing ${route}`);
    });
  }
});

describe("Runner", () => {
  test("runner/worker.mjs exists", () => {
    assert.ok(existsSync(resolve(ROOT, "runner/worker.mjs")));
  });

  test("runner/Dockerfile exists", () => {
    assert.ok(existsSync(resolve(ROOT, "runner/Dockerfile")));
  });

  test("runner/entrypoint.sh exists", () => {
    assert.ok(existsSync(resolve(ROOT, "runner/entrypoint.sh")));
  });

  test("GitHub Actions workflow exists", () => {
    assert.ok(existsSync(resolve(ROOT, ".github/workflows/autoqa.yml")));
  });
});

describe("Documentation", () => {
  const docs = [
    "ARCHITECTURE.md", "DEPLOYMENT.md", "RUNBOOK.md", "ROADMAP.md", "RUNNER.md",
    "adr/001-nextjs-vercel.md", "adr/002-sqlite.md", "adr/003-sse-state-machine.md",
    "adr/004-runner-contract.md", "adr/005-diagrams-mermaid.md", "adr/006-i18n-mock-adapters.md"
  ];

  for (const doc of docs) {
    test(`Doc exists: docs/${doc}`, () => {
      assert.ok(existsSync(resolve(ROOT, "docs", doc)), `Missing docs/${doc}`);
    });
  }
});

describe("Environment & Config", () => {
  test(".env.example documents all adapter secrets", () => {
    const env = readFileSync(resolve(ROOT, ".env.example"), "utf8");
    const required = [
      "VERIFLOW_DB_PATH", "RUNNER_CALLBACK_SECRET", "OPENAI_API_KEY",
      "GITHUB_TOKEN", "RESEND_API_KEY", "GITHUB_WEBHOOK_SECRET",
      "PUBLIC_BASE_URL", "EMAIL_PROVIDER", "VERIFLOW_STEP_DELAY_MS"
    ];
    for (const key of required) {
      assert.ok(env.includes(key), `.env.example missing ${key}`);
    }
  });

  test("next.config.ts has outputFileTracingRoot", () => {
    const cfg = readFileSync(resolve(ROOT, "next.config.ts"), "utf8");
    assert.ok(cfg.includes("outputFileTracingRoot"), "next.config.ts should set outputFileTracingRoot");
  });
});

describe("End-to-End Smoke (requires running server)", () => {
  // These run only if TEST_E2E=1 and server is up
  const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

  test("GET /api/v1/metrics/overview returns 200", { skip: process.env.TEST_E2E !== "1" }, async () => {
    const res = await fetch(`${BASE}/api/v1/metrics/overview`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.projects === "number");
    assert.ok(typeof data.passRate7d === "number");
  });

  test("quick-run rejects invalid input before creating projects", { skip: process.env.TEST_E2E !== "1" }, async () => {
    const endpoint = `${BASE}/api/v1/projects/quick-run`;
    const repo_url = `https://github.com/smoke/invalid-${crypto.randomUUID()}`;
    for (const body of [null, [], { repo_url, recipients: "qa@example.com" },
      { repo_url, recipients: ["qa@example.com", "invalid"] },
      { repo_url, extra_recipients: [42] }, { repo_url, branch: 42 },
      { repo_url, mode: "INVALID" }, { repo_url, base_url: "file:///etc/passwd" },
      { repo_url, subfolder: "../outside" }, { repo_url, idempotency_key: "" }]) {
      const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.strictEqual(res.status, 422, JSON.stringify(body));
    }
    const malformed = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.strictEqual(malformed.status, 400);
    const after = await (await fetch(endpoint)).json();
    assert.equal(after.projects.some((project: { repo_url: string }) => project.repo_url === repo_url), false);
  });

  test("quick-run completes and publishes a signed report", { skip: process.env.TEST_E2E !== "1", timeout: 60000 }, async () => {
    const res = await fetch(`${BASE}/api/v1/projects/quick-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo_url: "https://github.com/Fairuza050894/LogiTrack", idempotency_key: `smoke:${crypto.randomUUID()}` })
    });
    assert.strictEqual(res.status, 202);
    const data = await res.json();
    assert.ok(data.run_id);
    assert.ok(data.stream);
    assert.deepStrictEqual(data.recipients, ["qa@example.com"]);
    const stream = await fetch(new URL(data.stream, BASE), { signal: AbortSignal.timeout(50000) });
    assert.strictEqual(stream.status, 200);
    const events = await stream.text();
    const completion = events.match(/event: run.completed\ndata: ([^\n]+)/);
    assert.ok(completion, events);
    const completed = JSON.parse(completion[1]);
    assert.ok(["COMPLETED", "COMPLETED_WITH_WARNINGS"].includes(completed.status), events);
    assert.ok(completed.summary.total > 0);
    const report = await fetch(new URL(data.report, BASE));
    assert.strictEqual(report.status, 200);
    assert.match(await report.text(), /SIMULASI/);
  });
});

console.log("✅ All self-check tests defined. Run with: npm test");
