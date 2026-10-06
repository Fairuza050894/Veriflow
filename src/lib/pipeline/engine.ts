import { all, one, run as dbRun, J, tx, uid, nowIso, sha256, kvGet, kvSet } from "../db";
import { STEP_META, RUN_STEPS, type RunStatus, type StepName, type RunSummary, type RunCost, type Audience } from "../types";
import { cloneRepo } from "../workspace";
import { analyzeRepo } from "./analyze";
import { scaffoldFramework } from "./scaffold";
import { planTestsDeterministic } from "./plan";
import { generateTests, type GeneratedTest } from "./generate";
import { qualityGate, healTest } from "./quality";
import { planShards, executeShard, type ExecResult } from "./execute";
import { analyzeResults } from "./results";
import { extractArchitecture } from "../arch/extract";
import { composeDiagram, COMPOSERS } from "../arch/compose";
import { buildReportEmail, buildFailureEmail } from "../report";
import { sendEmail } from "../mailer";
import type { ArchModel, CoverageEntry, Analysis, TestPlan } from "../contracts";
import { rng, fmtPct, clamp } from "../util";
import type { Lang } from "../i18n";
import { randomBytes } from "node:crypto";

/**
 * ORCHESTRATOR — state machine durable (Arsitektur §4).
 *
 * ponytail: Temporal diganti state machine di atas SQLite karena Vercel serverless
 * tidak bisa menjalankan worker panjang. Konsekuensinya: pipeline digerakkan oleh
 * permintaan (SSE / POST /advance), TIDAK berjalan bila tidak ada yang memanggilnya.
 * `advanceRun()` idempotent + aman dipanggil paralel. Naik ke worker/VPS (docs/ARCHITECTURE.md §Batas)
 * hanya perlu mengganti pemicu advance dengan loop worker.
 */

const TERMINAL: RunStatus[] = ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED", "TIMED_OUT"];

// Context run: di-rehydrate dari DB tiap advance (durable, bukan in-memory).
type Ctx = {
  runId: string;
  projectId: string;
  mode: string;
  projectName: string;
  repoUrl: string;
  branch: string;
  envName: string;
  baseUrl: string;
  recipients: Array<{ email: string; locale: Lang }>;
  reportToken: string;
  trigger: string;
};

// Serialisasi per-run (avoid double execution saat SSE + POST concurrent)
const locks = new Map<string, Promise<unknown>>();

export function log(runId: string, step: string, message: string, level = "info") {
  dbRun("INSERT INTO run_logs(run_id, step, level, message, ts) VALUES(?,?,?,?,?)", [runId, step, level, message, nowIso()]);
}

export function setStatus(runId: string, status: RunStatus, extra: Record<string, unknown> = {}) {
  const fields: string[] = ["status = ?"];
  const params: Array<string | null> = [status];
  for (const [k, v] of Object.entries(extra)) {
    fields.push(`${k} = ?`);
    params.push(typeof v === "object" ? JSON.stringify(v) : (v as string));
  }
  dbRun(`UPDATE runs SET ${fields.join(", ")} WHERE id = ?`, [...params, runId]);
}

export async function createRun(input: {
  projectId: string; environmentId?: string | null; trigger?: string;
  mode?: string; idempotencyKey?: string; commitSha?: string; branch?: string;
}): Promise<{ runId: string; duplicate: boolean; reportToken?: string }> {
  const project = await one<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [input.projectId]);
  if (!project) throw new Error("project tidak ditemukan");

  const idem = input.idempotencyKey ?? `${input.projectId}:${input.commitSha ?? "head"}:${input.trigger ?? "manual"}`;
  const dup = await one<{ id: string }>("SELECT id FROM runs WHERE idempotency_key = ?", [idem]);
  if (dup) return { runId: dup.id, duplicate: true };

  const env = await one<{ id: string; name: string }>(
    input.environmentId
      ? "SELECT id, name FROM environments WHERE id = ?"
      : "SELECT id, name FROM environments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    input.environmentId ? [input.environmentId] : [input.projectId],
  );

  const runId = uid("run_");
  let token: string | undefined;
  await tx(async () => {
    dbRun(
      `INSERT INTO runs(id, project_id, environment_id, trigger, commit_sha, branch, mode, status, idempotency_key, started_at, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [runId, input.projectId, env?.id ?? null, input.trigger ?? "manual", input.commitSha ?? "",
        input.branch ?? String(project.default_branch ?? "main"), input.mode ?? String(project.mode ?? "FULL_AUTO"),
        "CREATED", idem, nowIso(), nowIso()],
    );
    RUN_STEPS.forEach((name, i) => {
      dbRun("INSERT INTO run_steps(id, run_id, name, status, seq) VALUES(?,?,?,?,?)", [uid("st_"), runId, name, "pending", i]);
    });
    // signed link report - use crypto.randomBytes for secure token
    token = randomBytes(32).toString("hex");
    // Don't store raw token in kv; only hash in database
    dbRun("INSERT INTO report_links(id, run_id, token_hash, expires_at) VALUES(?,?,?,?)",
      [uid("rl_"), runId, sha256(token), new Date(Date.now() + 14 * 864e5).toISOString()]);
  });
  log(runId, "QUEUED", `Run dibuat (trigger: ${input.trigger ?? "manual"}, mode: ${input.mode ?? project.mode})`);
  return { runId, duplicate: false, reportToken: token };
}

async function loadCtx(runId: string): Promise<Ctx | null> {
  const r = await one<Record<string, any>>(
    `SELECT r.*, p.name project_name, p.repo_url, e.name env_name, e.base_url
     FROM runs r JOIN projects p ON p.id = r.project_id
     LEFT JOIN environments e ON e.id = r.environment_id WHERE r.id = ?`,
    [runId],
  );
  if (!r) return null;
  const recips = await all<{ email: string; locale: string }>(
    "SELECT email, locale FROM recipients WHERE project_id = ? AND unsubscribed_at IS NULL",
    [r.project_id],
  );
  const token = kvGet(`report_token:${runId}`) ?? "";
  return {
    runId,
    projectId: r.project_id,
    mode: r.mode,
    projectName: r.project_name,
    repoUrl: r.repo_url,
    branch: r.branch,
    envName: r.env_name ?? "default",
    baseUrl: r.base_url ?? "",
    recipients: (recips.length ? recips : [{ email: "qa@example.com", locale: "id" }]).map((x) => ({
      email: x.email, locale: (x.locale === "en" ? "en" : "id") as Lang,
    })),
    reportToken: token,
    trigger: r.trigger,
  };
}

/** Pemicu utama: lanjutkan run dari step berikutnya. Idempotent & serial per run. */
export function advanceRun(runId: string): Promise<{ status: RunStatus }> {
  const prev = locks.get(runId) ?? Promise.resolve();
  const next = prev.then(() => advanceInner(runId)).catch(async (e) => {
    log(runId, "engine", `engine error: ${(e as Error).message}`, "error");
    return { status: "FAILED" as RunStatus };
  });
  locks.set(runId, next.catch(() => {}));
  return next;
}

async function advanceInner(runId: string): Promise<{ status: RunStatus }> {
  const ctx = await loadCtx(runId);
  if (!ctx) return { status: "FAILED" };
  const run = await one<Record<string, any>>("SELECT status, summary FROM runs WHERE id = ?", [runId]);
  if (!run) return { status: "FAILED" };
  if (TERMINAL.includes(run.status as RunStatus)) return { status: run.status as RunStatus };
  if (run.status === "WAITING_APPROVAL") return { status: "WAITING_APPROVAL" };
  if (run.status === "CANCELLED") return { status: "CANCELLED" };

  try {
    await drivePipeline(ctx);
  } catch (e) {
    log(runId, "engine", `Pipeline gagal: ${(e as Error).message}`, "error");
    await sendFailureEmail(ctx, (e as Error).message);
    setStatus(runId, "FAILED", { finished_at: nowIso(), error: { message: (e as Error).message } });
    return { status: "FAILED" };
  }
  const final = await one<{ status: RunStatus }>("SELECT status FROM runs WHERE id = ?", [runId]);
  return { status: final?.status ?? "FAILED" };
}

async function sendFailureEmail(ctx: Ctx, reason: string) {
  for (const r of ctx.recipients) {
    const m = buildFailureEmail({ projectName: ctx.projectName, envName: ctx.envName, reason, runId: ctx.runId, locale: r.locale });
    await sendEmail({ runId: ctx.runId, kind: "failure", to: r.email, locale: r.locale, ...m });
  }
  await sendEmail({
    runId: ctx.runId, kind: "failure", to: "owner@veriflow.dev", locale: "id",
    subject: `[Veriflow] Owner alert: run ${ctx.runId.slice(-6)} gagal`,
    html: `<p>Run <code>${ctx.runId}</code> gagal: ${reason}</p>`, text: `Run ${ctx.runId} gagal: ${reason}`,
  });
}

function stepCtx(runId: string) {
  return {
    start(name: StepName) {
      dbRun("UPDATE run_steps SET status='running', started_at=?, attempt=attempt+1 WHERE run_id=? AND name=? AND status='pending'", [nowIso(), runId, name]);
      setStatus(runId, name as RunStatus);
      log(runId, name, `▶ ${name} dimulai`);
    },
    ok(name: StepName, detail: Record<string, unknown> = {}) {
      dbRun("UPDATE run_steps SET status='succeeded', finished_at=?, detail=? WHERE run_id=? AND name=?", [nowIso(), JSON.stringify(detail), runId, name]);
      log(runId, name, `✔ ${name} selesai`);
    },
    skip(name: StepName, reason: string) {
      dbRun("UPDATE run_steps SET status='skipped', finished_at=?, detail=? WHERE run_id=? AND name=?", [nowIso(), JSON.stringify({ reason }), runId, name]);
      log(runId, name, `⤼ ${name} dilewati: ${reason}`, "warn");
    },
    done(name: StepName, detail: Record<string, unknown> = {}) {
      dbRun("UPDATE run_steps SET status='failed', finished_at=?, detail=? WHERE run_id=? AND name=?", [nowIso(), JSON.stringify(detail), runId, name]);
    },
  };
}

async function drivePipeline(ctx: Ctx) {
  const { runId } = ctx;
  const s = stepCtx(runId);
  const st = async (n: string) => (await one<{ status: string }>("SELECT status FROM run_steps WHERE run_id=? AND name=?", [runId, n]))?.status;
  const delay = Number(process.env.VERIFLOW_STEP_DELAY_MS ?? 220);

  // ── 1. CLONING ──────────────────────────────────────────────────────────
  if ((await st("CLONING")) === "pending") {
    s.start("CLONING");
    const ws = await cloneRepo({ url: ctx.repoUrl, branch: ctx.branch });
    kvSet(`ws:${runId}`, JSON.stringify({ url: ws.url, branch: ws.branch, commit: ws.commit, files: ws.files, bytes: ws.bytes }));
    s.ok("CLONING", { commit: ws.commit, files: Object.keys(ws.files).length, bytes: ws.bytes });
  }
  const wsRaw = kvGet(`ws:${runId}`);
  if (!wsRaw) throw new Error("workspace hilang setelah CLONING");
  const ws = J.parse<{ url: string; branch: string; commit: string; files: Record<string, string>; bytes: number }>(wsRaw, { url: ctx.repoUrl, branch: ctx.branch, commit: "", files: {}, bytes: 0 });
  await dbRun("UPDATE runs SET commit_sha = ? WHERE id = ?", [ws.commit, runId]);

  // ── 2. ANALYZING (+ arch extraction paralel, non-blocking) ───────────────
  if ((await st("ANALYZING")) === "pending") {
    s.start("ANALYZING");
    const analysis = analyzeRepo(ws);
    kvSet(`analysis:${runId}`, JSON.stringify(analysis));
    // Repo intelligence: ekstraksi deterministik berjalan paralel & non-fatal (§18.14)
    try {
      const model = extractArchitecture(ws, uid("arch_"));
      kvSet(`arch:${runId}`, JSON.stringify(model));
      s.ok("ANALYZING", {
        framework: analysis.stack.frameworks.join(", "),
        routes: analysis.app.routes.length,
        endpoints: analysis.api.endpoints.length,
        arch_nodes: model.nodes.length,
        extractors: model.extractors.map((e) => e.name).join(","),
      });
    } catch (e) {
      log(runId, "ANALYZING", `Arch extraction dilewati: ${(e as Error).message}`, "warn");
      s.ok("ANALYZING", { arch: "skipped" });
    }
    await sleep(delay);
  }
  const analysis = J.parse<Analysis | null>(kvGet(`analysis:${runId}`), null);
  if (!analysis) throw new Error("analysis hilang");

  // ── 3. SCAFFOLDING ──────────────────────────────────────────────────────
  if ((await st("SCAFFOLDING")) === "pending") {
    s.start("SCAFFOLDING");
    const project = await one<{ scaffold_root: string }>("SELECT scaffold_root FROM projects WHERE id = ?", [ctx.projectId]);
    const sc = scaffoldFramework(ws, analysis, project?.scaffold_root ?? "autoqa");
    kvSet(`scaffold:${runId}`, JSON.stringify(sc));
    s.ok("SCAFFOLDING", { created: sc.created.length, skipped_existing: sc.skipped.length });
    await sleep(delay);
  }

  // ── 4. PLANNING ─────────────────────────────────────────────────────────
  if ((await st("PLANNING")) === "pending") {
    s.start("PLANNING");
    const plan = planTestsDeterministic(analysis);
    kvSet(`plan:${runId}`, JSON.stringify(plan));
    s.ok("PLANNING", { concepts: plan.concepts.length, p0: plan.concepts.filter((c) => c.priority === "P0").length });
    await sleep(delay);
  }
  const plan = J.parse<TestPlan | null>(kvGet(`plan:${runId}`), null);
  if (!plan) throw new Error("test plan hilang");

  // ── 5. GENERATING ───────────────────────────────────────────────────────
  let generated: GeneratedTest[] = J.parse<GeneratedTest[]>(kvGet(`generated:${runId}`), []);
  if ((await st("GENERATING")) === "pending") {
    s.start("GENERATING");
    generated = generateTests(plan, (await one<{ scaffold_root: string }>("SELECT scaffold_root FROM projects WHERE id = ?", [ctx.projectId]))?.scaffold_root ?? "autoqa");
    for (const g of generated) ws.files[g.file] = g.code;
    kvSet(`generated:${runId}`, JSON.stringify(generated));
    s.ok("GENERATING", { files: generated.length, api: generated.filter((g) => g.layer === "api").length, ui: generated.filter((g) => g.layer === "ui").length, e2e: generated.filter((g) => g.layer === "e2e").length });
    await sleep(delay);
  }

  // ── 6. VALIDATING ⇄ HEALING (max 3 iterasi, BP-09) ──────────────────────
  let iteration = 0;
  let gate = qualityGate(generated, `${runId}:gate`, 0);
  while (!gate.passed && iteration < 3) {
    if ((await st("HEALING")) !== "running" && (await st("HEALING")) === "pending") {
      s.start("HEALING");
      log(runId, "VALIDATING", `Quality gate gagal: ${gate.failures.length} masalah. Self-heal iterasi ${iteration + 1}/3`, "warn");
    }
    const failuresByTest = new Map<string, string[]>();
    for (const f of gate.failures) failuresByTest.set(f.testId, [...(failuresByTest.get(f.testId) ?? []), f.message]);
    generated = generated.map((g) => {
      const reasons = failuresByTest.get(g.conceptId);
      return reasons ? healTest(g, reasons.join("; ")) : g;
    });
    for (const g of generated) ws.files[g.file] = g.code;
    iteration++;
    if ((await st("VALIDATING")) === "pending" || (await st("HEALING")) === "running") s.start("VALIDATING");
    gate = qualityGate(generated, `${runId}:gate`, iteration);
    if (gate.passed) { s.ok("HEALING", { healed: iteration, remaining: 0 }); }
    await sleep(delay * 0.6);
  }
  if ((await st("VALIDATING")) === "pending" || (await st("VALIDATING")) === "running") {
    if (gate.passed) s.ok("VALIDATING", { checked: gate.checked, healed_iterations: iteration });
    else {
      // tidak stabil setelah 3 iterasi → quarantine (BP-09)
      const bad = new Set(gate.failures.map((f) => f.testId));
      generated = generated.map((g) => (bad.has(g.conceptId) ? { ...g, tags: [...new Set([...g.tags, "@quarantine"])] } : g));
      s.done("VALIDATING", { unstable: [...bad] });
      log(runId, "VALIDATING", `${bad.size} test tidak bisa distabilkan → dipindah ke quarantine`, "warn");
      dbRun("UPDATE run_steps SET status='succeeded' WHERE run_id=? AND name='HEALING'", [runId]);
    }
  }
  kvSet(`generated:${runId}`, JSON.stringify(generated));

  // ── 7. WAITING_APPROVAL (mode REVIEW-GATE) ──────────────────────────────
  if (ctx.mode === "REVIEW_GATE") {
    if ((await st("WAITING_APPROVAL")) === "pending") {
      s.start("WAITING_APPROVAL");
      await sendEmail({
        runId, kind: "approval_needed", to: ctx.recipients[0].email, locale: ctx.recipients[0].locale,
        subject: `[Veriflow] Persetujuan test diperlukan · ${ctx.projectName}`,
        html: `<p>Run menunggu persetujuan engineer. Buka dashboard untuk review diff.</p>`,
        text: `Run menunggu persetujuan engineer. Buka dashboard untuk review diff.`,
      });
      return; // engine berhenti; dilanjutkan approveRun()
    }
    if ((await st("WAITING_APPROVAL")) === "succeeded") {
      // approved -> lanjut
    } else {
      return;
    }
  }

  // ── 8. COMMITTING ───────────────────────────────────────────────────────
  if ((await st("COMMITTING")) === "pending") {
    s.start("COMMITTING");
    const diff = buildUnifiedDiff(generated);
    kvSet(`diff:${runId}`, diff);
    const pr = { number: 100 + (parseInt(sha256(runId).slice(0, 4), 16) % 900), url: "", title: `[Veriflow] Generated tests for ${runId.slice(-6)}` };
    pr.url = `${ctx.repoUrl.replace(/\/$/, "")}/pull/${pr.number}`;
    kvSet(`pr:${runId}`, JSON.stringify(pr));
    s.ok("COMMITTING", { branch: `autoqa/${runId.slice(-6)}`, pr: pr.number, files: generated.length });
    await sleep(delay);
  }

  // ── 9. PROVISIONING (sharding) ──────────────────────────────────────────
  let shards: ReturnType<typeof planShards> = [];
  if ((await st("PROVISIONING")) === "pending") {
    s.start("PROVISIONING");
    shards = planShards(generated, new Map());
    kvSet(`shards:${runId}`, JSON.stringify(shards));
    s.ok("PROVISIONING", { shards: shards.length, tests: generated.length });
    await sleep(delay);
  } else {
    shards = J.parse(kvGet(`shards:${runId}`), []);
  }

  // ── 10. EXECUTING ───────────────────────────────────────────────────────
  let execResults: ExecResult[] = [];
  if ((await st("EXECUTING")) === "pending") {
    s.start("EXECUTING");
    log(runId, "EXECUTING", `Menjalankan ${generated.length} test dalam ${shards.length} shard (workers=${shards.length})`);
    for (const shard of shards) {
      const res = await executeShard(shard, generated, runId, {
        onProgress: (done, total) => log(runId, "EXECUTING", `shard ${shard.index}/${shard.total} progress ${done}/${total}`, "debug"),
      });
      execResults.push(...res);
      kvSet(`exec:${runId}:${shard.index}`, JSON.stringify(res));
    }
    kvSet(`exec:${runId}`, JSON.stringify(execResults));
    s.ok("EXECUTING", { tests: execResults.length, shards: shards.length, runner_seconds: Math.round(execResults.reduce((a, r) => a + r.durationMs, 0) / 1000) });
  } else {
    execResults = J.parse<ExecResult[]>(kvGet(`exec:${runId}`), []);
  }

  // ── 11. ANALYZING_RESULTS ───────────────────────────────────────────────
  let summary: RunSummary | null = null;
  if ((await st("ANALYZING_RESULTS")) === "pending") {
    s.start("ANALYZING_RESULTS");
    const prev = await one<{ summary: string }>(
      "SELECT summary FROM runs WHERE project_id=? AND id<>? AND summary IS NOT NULL ORDER BY created_at DESC LIMIT 1", [ctx.projectId, runId]);
    const prevRate = prev ? (J.parse<RunSummary>(prev.summary, summaryFallback()).pass_rate) : null;
    summary = analyzeResults(execResults, generated, shards, prevRate);
    kvSet(`summary:${runId}`, JSON.stringify(summary));
    persistTestResults(runId, ctx.projectId, generated, execResults);
    s.ok("ANALYZING_RESULTS", { pass_rate: summary.pass_rate, failed: summary.failed, flaky: summary.flaky });
    await sleep(delay);
  } else {
    summary = J.parse<RunSummary | null>(kvGet(`summary:${runId}`), null);
  }
  if (!summary) throw new Error("summary hilang");

  // ── 12. REPORTING (diagram + overlay + report) ─────────────────────────
  if ((await st("REPORTING")) === "pending") {
    s.start("REPORTING");
    const model = J.parse<ArchModel | null>(kvGet(`arch:${runId}`), null);
    const coverage = buildCoverage(model, generated, execResults);
    persistArch(ctx, model, coverage, generated);
    const diagrams = renderDiagrams(ctx, model, coverage);
    const reportUrl = `${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/r/${ctx.reportToken}`;
    const verdict = renderReport(ctx, summary, diagrams, reportUrl);
    dbRun("UPDATE runs SET summary=?, cost=?, report_url=? WHERE id = ?", [JSON.stringify(summary), JSON.stringify(verdict.cost), reportUrl, runId]);
    s.ok("REPORTING", { diagrams: diagrams.length, email_size_kb: Math.round(verdict.html.length / 1024) });
    await sleep(delay);
  }

  // ── 13. NOTIFYING ───────────────────────────────────────────────────────
  if ((await st("NOTIFYING")) === "pending") {
    s.start("NOTIFYING");
    const summary2 = J.parse<RunSummary>(kvGet(`summary:${runId}`), summaryFallback());
    const model = J.parse<ArchModel | null>(kvGet(`arch:${runId}`), null);
    const diagrams = await all<{ kind: string; title: string; alt_text: string | null; in_email: number }>(
      "SELECT kind, title, alt_text, in_email FROM diagrams WHERE run_id = ?", [runId]);
    const reportUrl = `${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/r/${ctx.reportToken}`;

    let sent = 0;
    for (const r of ctx.recipients) {
      const email = buildReportEmail({
        runId, projectName: ctx.projectName, envName: ctx.envName, commit: ws.commit, branch: ctx.branch,
        summary: summary2,
        diagrams: diagrams.filter((d) => d.in_email === 1).map((d) => ({ kind: d.kind as never, title: d.title, alt_text: d.alt_text, in_email: 1, audience: "customer" as const })),
        reportUrl, locale: r.locale,
      });
      const res = await sendEmail({ runId, kind: "report", to: r.email, locale: r.locale, ...email });
      if (res.sent || process.env.EMAIL_PROVIDER === "outbox") sent++;
      log(runId, "NOTIFYING", `📧 report → ${r.email} (${res.detail})`);
    }
    const verdict = J.parse<RunSummary>(kvGet(`summary:${runId}`), summaryFallback());
    const cost = estimateCost(runId, execResults);
    dbRun("UPDATE runs SET cost=?, summary=? WHERE id = ?", [JSON.stringify(cost), JSON.stringify(verdict), runId]);
    s.ok("NOTIFYING", { recipients: ctx.recipients.length, sent });
  }

  // ── 14. FINISH ──────────────────────────────────────────────────────────
  const finalSummary = J.parse<RunSummary>(kvGet(`summary:${runId}`), summaryFallback());
  setStatus(runId, hasWarnings(finalSummary) ? "COMPLETED_WITH_WARNINGS" : "COMPLETED", { finished_at: nowIso() });
  log(runId, "engine", `🏁 Run selesai: ${hasWarnings(finalSummary) ? "selesai dengan peringatan" : "sukses"}`);
}

const hasWarnings = (s: RunSummary) => s.failed > 0 || s.flaky > 0 || (s.categories?.infra ?? 0) > 0;

function summaryFallback(): RunSummary {
  return { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, duration_ms: 0, pass_rate: 0, delta_pass_rate: null, categories: {}, top_failures: [] };
}

async function persistTestResults(runId: string, projectId: string, generated: GeneratedTest[], results: ExecResult[]) {
  const byId = new Map(generated.map((g) => [g.conceptId, g]));
  await tx(async () => {
    await dbRun("DELETE FROM test_results WHERE run_id = ?", [runId]);
    for (const r of results) {
      const g = byId.get(r.testId);
      if (!g) continue;
      await dbRun(
        `INSERT INTO test_results(id, run_id, project_id, file, title, layer, tags, status, duration_ms, retries, error_message, error_category, prompt_version, model, quarantined, covers)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid("tr_"), runId, projectId, g.file, g.title, g.layer, JSON.stringify(g.tags), r.status, r.durationMs, r.retries,
          r.errorMessage, r.errorCategory, "v2-generator", "mock-llm", g.tags.includes("@quarantine") ? 1 : 0, JSON.stringify(g.covers)],
      );
      // statistik & skor flaky
      const hist = await all<{ id: string }>("SELECT id FROM test_stats WHERE project_id=? AND title=?", [projectId, g.title]);
      const statId = uid("ts_");
      await dbRun(
        `INSERT INTO test_stats(id, project_id, file, title, runs, avg_duration_ms, flaky_score, consecutive_green, last_status)
         VALUES(?,?,?,?,1,?,?,?,?)`,
        [statId, projectId, g.file, g.title, r.durationMs, r.status === "flaky" ? 0.2 : 0, r.status === "passed" ? 1 : 0, r.status],
      );
      void hist;
    }
  });
}

function buildCoverage(
  model: ArchModel | null,
  generated: GeneratedTest[],
  results: ExecResult[],
): Record<string, CoverageEntry> {
  const cov: Record<string, CoverageEntry> = {};
  if (!model) return cov;
  const byTest = new Map(generated.map((g) => [g.conceptId, g]));
  const resByTest = new Map(results.map((r) => [r.testId, r]));
  for (const r of results) {
    const g = byTest.get(r.testId);
    for (const nodeId of g?.covers ?? []) {
      const c = cov[nodeId] ?? { tests: 0, passed: 0, failed: 0, flaky: 0, state: "untested" as const };
      c.tests++;
      if (r.status === "passed") c.passed++;
      else if (r.status === "failed") c.failed++;
      else if (r.status === "flaky") c.flaky++;
      c.state = c.failed > 0 ? "failed" : c.flaky > 0 ? "flaky" : c.passed > 0 ? "passed" : "untested";
      cov[nodeId] = c;
    }
  }
  // node tanpa test -> untested (FR-DGM-09)
  for (const n of model.nodes) {
    if (!cov[n.id]) cov[n.id] = { tests: 0, passed: 0, failed: 0, flaky: 0, state: "untested" };
  }
  return cov;
}

async function persistArch(ctx: Ctx, model: ArchModel | null, cov: Record<string, CoverageEntry>, generated: GeneratedTest[]) {
  if (!model) return;
  const snapId = model.snapshot_id;
  await tx(async () => {
    await dbRun(
      `INSERT INTO arch_snapshots(id, project_id, run_id, commit_sha, model, node_count, edge_count, extractor_status, created_at)
       VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
      [snapId, ctx.projectId, ctx.runId, model.repo.commit, JSON.stringify(model), model.nodes.length, model.edges.length, JSON.stringify(model.extractors), nowIso()],
    );
    for (const [nodeId, c] of Object.entries(cov)) {
      const kind = model.nodes.find((n) => n.id === nodeId)?.kind ?? "unknown";
      await dbRun(
        `INSERT INTO node_coverage(run_id, node_id, kind, tests_total, passed, failed, flaky, state)
         VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id, node_id) DO UPDATE SET state=excluded.state`,
        [ctx.runId, nodeId, kind, c.tests, c.passed, c.failed, c.flaky, c.state],
      );
    }
    for (const f of model.findings) {
      await dbRun("INSERT INTO arch_findings(id, snapshot_id, code, severity, title, detail, nodes, evidence) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        [f.id, snapId, f.type, f.severity, f.type, f.detail, JSON.stringify(f.nodes), JSON.stringify(f.evidence)]);
    }
    // devops findings ringkas dari docker/CI audit
    for (const f of model.findings.filter((f) => f.type.startsWith("dockerfile") || f.type.startsWith("ci_"))) {
      await dbRun("INSERT INTO devops_findings(id, run_id, tool, severity, rule, location, message, fix_hint) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        [uid("dv_"), ctx.runId, f.type.startsWith("dockerfile") ? "hadolint" : "ci-parser", f.severity, f.type, f.evidence[0]?.file ?? "-", f.detail, null]);
    }
  });
  void generated;
}

function renderDiagrams(ctx: Ctx, model: ArchModel | null, cov: Record<string, CoverageEntry>) {
  if (!model) return [];
  const out: Array<{ kind: string; title: string; alt_text: string | null; in_email: number; audience: string }> = [];
  const locale = ctx.recipients[0]?.locale ?? "id";
  for (const [kind, meta] of Object.entries(COMPOSERS)) {
    try {
      const audience = kind === "D02" || kind === "D03" || kind === "D04" || kind === "D05" ? "internal" : meta.audience;
      const composed = composeDiagram(kind as any, { model, coverage: cov, audience, locale });
      const alt = buildAlt(kind, composed.nodeCount, composed.truncated, locale);
      dbRun(
        `INSERT INTO diagrams(id, snapshot_id, run_id, kind, title, audience, syntax, source, node_count, truncated, ai_summary, status, in_email, alt_text)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid("dg_"), model.snapshot_id, ctx.runId, kind, meta.title[locale] ?? meta.title.id, audience, "mermaid",
          composed.source, composed.nodeCount, composed.truncated ? 1 : 0, null, "ok", meta.inEmail ? 1 : 0, alt],
      );
      out.push({ kind, title: meta.title[locale] ?? meta.title.id, alt_text: alt, in_email: meta.inEmail ? 1 : 0, audience });
    } catch (e) {
      // §18.15 / FR-DGM-22: kegagalan diagram tidak boleh menggagalkan run
      dbRun(
        `INSERT INTO diagrams(id, snapshot_id, run_id, kind, title, audience, syntax, source, node_count, status, alt_text)
         VALUES(?,?,?,?,?,?,?,?,?,'skipped',?)`,
        [uid("dg_"), model.snapshot_id, ctx.runId, kind, kind, "internal", "mermaid", "", 0, `gagal: ${(e as Error).message}`],
      );
      log(ctx.runId, "REPORTING", `⚠ diagram ${kind} dilewati: ${(e as Error).message}`, "warn");
    }
  }
  return out;
}

function buildAlt(kind: string, nodeCount: number, truncated: boolean, locale: Lang): string {
  const base = {
    D01: (locale === "id" ? "Diagram container: layanan, database, dan dependensi antar komponen" : "Container diagram: services, databases, dependencies"),
    D09: (locale === "id" ? "Cakupan test per komponen" : "Test coverage per component"),
    D07: (locale === "id" ? "Alur pipeline CI/CD" : "CI/CD pipeline flow"),
    D08: (locale === "id" ? "Topologi deploy" : "Deploy topology"),
    D02: (locale === "id" ? "Diagram relasi basis data (khusus internal)" : "Database ERD (internal only)"),
    D03: (locale === "id" ? "Graf dependensi modul" : "Module dependency graph"),
    D04: (locale === "id" ? "Peta endpoint API" : "API endpoint map"),
    D05: (locale === "id" ? "Peta halaman UI" : "UI page map"),
  }[kind] ?? kind;
  return `${base}. ${nodeCount} node${truncated ? (locale === "id" ? ", dipangkas" : ", truncated") : ""}.`;
}

function renderReport(ctx: Ctx, summary: RunSummary, diagrams: Array<{ kind: string; title: string; alt_text: string | null; in_email: number; audience: string }>, reportUrl: string) {
  const cost = estimateCost(ctx.runId, []);
  const email = buildReportEmail({
    runId: ctx.runId, projectName: ctx.projectName, envName: ctx.envName, commit: "", branch: ctx.branch,
    summary, diagrams: diagrams.map((d) => ({ kind: d.kind as never, title: d.title, alt_text: d.alt_text, in_email: d.in_email, audience: d.audience as Audience })),
    reportUrl, locale: ctx.recipients[0]?.locale ?? "id",
  });
  // Laporan HTML lengkap dirakit saat halaman publik dibuka (on-demand) —
  // tidak perlu duplikat besar di DB.
  kvSet(`report:${ctx.runId}`, JSON.stringify({ summary, diagrams, reportUrl, builtAt: nowIso() }));
  return { html: email.html, cost };
}

function estimateCost(runId: string, results: ExecResult[]): RunCost {
  const r = rng(runId);
  const aiCalls = 3 + Math.floor(r() * 4);
  const tokensIn = 12_000 + Math.floor(r() * 20_000);
  const tokensOut = 6_000 + Math.floor(r() * 12_000);
  const costUsd = Number(((tokensIn * 3 + tokensOut * 15) / 1_000_000).toFixed(4));
  const runnerSeconds = Math.round(results.reduce((a, x) => a + x.durationMs, 0) / 1000);
  dbRun("DELETE FROM ai_calls WHERE run_id = ?", [runId]);
  const roles = ["analyzer", "planner", "generator-ui", "generator-api", "healer", "summarizer"];
  for (let i = 0; i < aiCalls; i++) {
    dbRun("INSERT INTO ai_calls(id, run_id, step, prompt_name, prompt_version, model, input_tokens, output_tokens, cost_usd, latency_ms) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [uid("ai_"), runId, "pipeline", roles[i % roles.length], "v2", "mock-llm", Math.round(tokensIn / aiCalls), Math.round(tokensOut / aiCalls),
        Number((costUsd / aiCalls).toFixed(4)), 800 + Math.floor(r() * 2500)]);
  }
  return { tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd, runner_seconds: runnerSeconds, ai_calls: aiCalls };
}

function buildUnifiedDiff(generated: GeneratedTest[]): string {
  const lines: string[] = ["diff --git a/autoqa b/autoqa", "new files mode 100644"];
  for (const g of generated.slice(0, 200)) {
    lines.push(`--- /dev/null`, `+++ b/${g.file}`, `@@ -0,0 +1,${g.code.split("\n").length} @@`);
    for (const l of g.code.split("\n")) lines.push(`+${l}`);
  }
  return lines.join("\n");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const clampPassRate = (n: number) => clamp(n, 0, 1);
export const fmtRate = fmtPct;