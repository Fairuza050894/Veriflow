import { all, one, run as dbRun, J, tx, uid, nowIso, kvGet } from "./db";
import type { RunSummary } from "./types";

export async function ensureSeeded() {
  if (process.env.VERIFLOW_SEED === "false") return;
  await tx(async () => {
    const n = await one<{ n: number }>("SELECT COUNT(*) n FROM organizations");
    if ((n?.n ?? 0) > 0) return;
    await seedDemo();
  });
}

/** Data demo supaya dashboard langsung hidup pada install baru. */
export async function seedDemo() {
  const orgId = uid("org_");
  const projectId = uid("prj_");
  const stagingId = uid("env_");
  await tx(async () => {
    await dbRun("INSERT INTO organizations(id, name, plan, created_at) VALUES(?,?,?,?)", [orgId, "Logistics Group", "scale", nowIso()]);
    await dbRun(
      `INSERT INTO projects(id, org_id, name, repo_provider, repo_url, default_branch, mode, scaffold_root, settings, detected, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [projectId, orgId, "LogiTrack Web", "github", "https://github.com/logistics-id/logitrack-web", "main", "FULL_AUTO", "autoqa",
        JSON.stringify({ max_tests_per_run: 60, browsers: ["chromium"], report_lang: "auto" }), null, nowIso()],
    );
    await dbRun("INSERT INTO environments(id, project_id, name, base_url, api_base_url, auth_strategy, read_only) VALUES(?,?,?,?,?,?,?)",
      [stagingId, projectId, "staging", "https://staging.logitrack.io", "https://staging.logitrack.io", "bearer", 0]);
    for (const [email, locale] of [["qa@logistics-id.com", "id"], ["ops@logitrack.io", "en"]] as const) {
      await dbRun("INSERT INTO recipients(id, project_id, email, kind, locale, verified_at) VALUES(?,?,?,?,?,?)",
        [uid("rcp_"), projectId, email, "to", locale, nowIso()]);
    }
    // riwayat 7 run supaya tren & sparkline tidak kosong
    const n = await one<{ id: string }>("SELECT id FROM projects WHERE id = ?", [projectId]);
    if (n) await seedHistory(projectId, stagingId);
  });
}

async function seedHistory(projectId: string, envId: string) {
  const baseRates = [0.88, 0.9, 0.87, 0.93, 0.91, 0.95, 0.94];
  const cats: Array<Record<string, number>> = [
    { product_bug: 3, test_bug: 2, flaky: 2 },
    { product_bug: 2, test_bug: 3, flaky: 1 },
    { product_bug: 4, test_bug: 1, flaky: 3 },
    { product_bug: 1, test_bug: 1, flaky: 1 },
    { product_bug: 2, flaky: 2, env_issue: 1 },
    { flaky: 1 },
    { flaky: 1 },
  ];
  const statuses = ["COMPLETED_WITH_WARNINGS", "COMPLETED_WITH_WARNINGS", "COMPLETED_WITH_WARNINGS", "COMPLETED", "COMPLETED_WITH_WARNINGS", "COMPLETED", "COMPLETED"];
  for (const [i, rate] of baseRates.entries()) {
    const total = 118 + i * 2;
    const flaky = Math.max(0, (cats[i].flaky ?? 0));
    const failed = Math.round(total * (1 - rate) - flaky * 0.5);
    const passed = total - failed - flaky;
    const runId = uid("run_");
    const created = new Date(Date.now() - (baseRates.length - i) * 864e5 * 1.4).toISOString();
    const summary: RunSummary = {
      total, passed, failed, flaky, skipped: 0,
      duration_ms: (240 + i * 12) * 1000,
      pass_rate: rate,
      delta_pass_rate: i === 0 ? null : Number((rate - baseRates[i - 1]).toFixed(4)),
      categories: cats[i],
      top_failures: [
        { title: "POST /api/shipments - tolak payload tidak valid", file: "autoqa/tests/api/shipments-post.spec.ts", category: "product_bug", message: "expected 422, received 500" },
        { title: "Halaman /shipments - tampil tanpa error", file: "autoqa/tests/ui/shipments.spec.ts", category: "test_bug", message: "locator shipments-table tidak ditemukan" },
      ].slice(0, Math.max(0, Math.min(2, failed))),
    };
    await dbRun(
      `INSERT INTO runs(id, project_id, environment_id, trigger, commit_sha, branch, mode, status, idempotency_key, started_at, finished_at, summary, cost, report_url, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [runId, projectId, envId, i % 3 === 0 ? "webhook" : i % 3 === 1 ? "schedule" : "manual",
        `${(0xa1b2c3d + i).toString(16)}e5f60718`, "main", "FULL_AUTO", statuses[i],
        `seed:${projectId}:${i}`, created, created, JSON.stringify(summary),
        JSON.stringify({ tokens_in: 32000 + i * 900, tokens_out: 15000 + i * 400, cost_usd: 0.31 + i * 0.03, runner_seconds: 210 + i * 8, ai_calls: 6 }),
        null, created],
    );
    for (const [seq, name] of RUN_STEP_NAMES.entries()) {
      const ok = statuses[i] !== "FAILED";
      await dbRun("INSERT INTO run_steps(id, run_id, name, status, attempt, started_at, finished_at, seq) VALUES(?,?,?,?,?,?,?,?)",
        [uid("st_"), runId, name, ok ? (name === "HEALING" && i % 2 ? "skipped" : "succeeded") : "failed", 1, created, created, seq]);
    }
    for (let k = 0; k < 14; k++) {
      const roll = (i * 7 + k * 13) % 100;
      const status = roll < 88 ? "passed" : roll < 94 ? "flaky" : "failed";
      await dbRun(
        `INSERT INTO test_results(id, run_id, project_id, file, title, layer, tags, status, duration_ms, retries, error_message, error_category, prompt_version, model, covers)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid("tr_"), runId, projectId,
          k % 3 === 0 ? "autoqa/tests/api/shipments.spec.ts" : k % 3 === 1 ? "autoqa/tests/ui/shipments.spec.ts" : "autoqa/tests/e2e/booking.spec.ts",
          `Test #${k + 1} — ${k % 2 ? "UI" : "API"} regression`, k % 3 === 1 ? "ui" : k % 3 === 2 ? "e2e" : "api",
          JSON.stringify(["@smoke", k % 3 === 1 ? "@ui" : "@api"]), status, 900 + k * 210, status === "flaky" ? 1 : 0,
          status === "failed" ? "expected 201, received 422" : null,
          status === "failed" ? (k % 2 ? "product_bug" : "test_bug") : status === "flaky" ? "flaky" : null,
          "v2-generator", "mock-llm", JSON.stringify(["api:GET /api/shipments"])],
      );
    }
    await dbRun("INSERT INTO email_messages(id, run_id, kind, to_email, subject, status, attempts, body_html, idempotency_key, created_at, sent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [uid("eml_"), runId, "report", "qa@logistics-id.com", `[Veriflow] LogiTrack Web - ${Math.round(rate * 100)}% lulus - Run #${runId.slice(-6)}`, "sent", 1,
        "<p>Laporan otomatis.</p>", `seed:${runId}:report:qa`, created, created]);
  }
}

const RUN_STEP_NAMES = [
  "CLONING", "ANALYZING", "SCAFFOLDING", "PLANNING", "GENERATING", "VALIDATING",
  "HEALING", "COMMITTING", "PROVISIONING", "EXECUTING", "ANALYZING_RESULTS", "REPORTING", "NOTIFYING",
];

// ───────────────────────────── query dashboard ─────────────────────────────
export type Overview = {
  projects: number;
  runs24h: number;
  passRate7d: number;
  flakyActive: number;
  costMonth: number;
  emailsSent: number;
  durationP95: number;
  passTrend: Array<{ day: string; rate: number; runs: number }>;
  runDurations: Array<{ label: string; p50: number; p95: number }>;
  categories: Array<{ key: string; n: number }>;
  slowest: Array<{ title: string; ms: number }>;
  flakyTop: Array<{ title: string; score: number }>;
  recentRuns: RecentRun[];
  attentionRuns: RecentRun[];
  queueDepth: number;
  runnerActive: number;
};

export type RecentRun = {
  id: string; project_id: string; project_name: string; env_name: string | null;
  status: string; commit_sha: string; branch: string; trigger: string; created_at: string;
  finished_at: string | null; summary: RunSummary | null; cost: { cost_usd?: number } | null; report_url: string | null;
};

export async function overview(orgId?: string): Promise<Overview> {
  const scope = orgId ? "AND p.org_id = ?" : "";
  const args: Array<string> = orgId ? [orgId] : [];
  const projects = (await one<{ n: number }>(`SELECT COUNT(*) n FROM projects p WHERE 1=1 ${scope}`, args))?.n ?? 0;
  const since = new Date(Date.now() - 864e5).toISOString();
  const runs24h = (await one<{ n: number }>(`SELECT COUNT(*) n FROM runs WHERE created_at > ? ${scope ? "AND project_id IN (SELECT id FROM projects WHERE org_id=?)" : ""}`,
    orgId ? [since, orgId] : [since]))?.n ?? 0;

  const recent = await all<{ d: string; pass_rate: number }>(
    `SELECT substr(created_at,1,10) d, JSON_EXTRACT(summary,'$.pass_rate') pass_rate
     FROM runs WHERE summary IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 60`, [new Date(Date.now() - 14 * 864e5).toISOString()]);
  const byDay = new Map<string, number[]>();
   for (const r of recent) byDay.set(r.d, [...(byDay.get(r.d) ?? []), Number(r.pass_rate ?? 0)]);
  const passTrend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, arr]) => ({ day, rate: arr.reduce((x, y) => x + y, 0) / arr.length, runs: arr.length }));
  const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const passRate7d = passTrend.filter((point) => point.day >= sevenDaysAgo);

  const durations = (await all<{ ms: number }>(
    `SELECT CAST(json_extract(summary,'$.duration_ms') AS INTEGER) ms FROM runs WHERE summary IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 50`,
    [new Date(Date.now() - 14 * 864e5).toISOString()])).map((r) => r.ms).filter((n) => n > 0).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

  const categories = await all<{ key: string; n: number }>(
    `SELECT error_category key, COUNT(*) n FROM test_results WHERE error_category IS NOT NULL AND run_id IN
       (SELECT id FROM runs WHERE created_at > ?) GROUP BY error_category ORDER BY n DESC`,
    [new Date(Date.now() - 14 * 864e5).toISOString()]);

  const slowest = (await all<{ title: string; ms: number }>(
    `SELECT title, AVG(duration_ms) ms FROM test_results GROUP BY title ORDER BY ms DESC LIMIT 8`))
    .map((r) => ({ title: r.title, ms: r.ms ?? 0 }));
  const flakyTop = (await all<{ title: string; score: number }>(
    `SELECT title, AVG(flaky_score) score FROM test_stats WHERE flaky_score > 0 GROUP BY title ORDER BY score DESC LIMIT 8`))
    .map((r) => ({ title: r.title, score: r.score ?? 0 }));

  const recentRuns = await allRunRows(`${orgId ? "WHERE p.org_id = ? " : ""}ORDER BY r.created_at DESC LIMIT 8`, args);
  const attentionRuns = await allRunRows(
    `WHERE r.status IN ('FAILED','WAITING_APPROVAL','TIMED_OUT') ${orgId ? "AND p.org_id = ?" : ""} ORDER BY r.created_at DESC LIMIT 8`,
    orgId ? [orgId] : []);

  const result: Overview = {
    projects,
    runs24h,
    passRate7d: passRate7d.length ? passRate7d.reduce((a, b) => a + b.rate * b.runs, 0) / passRate7d.reduce((a, b) => a + b.runs, 0) : 0,
    flakyActive: (await one<{ n: number }>("SELECT COUNT(*) n FROM test_stats WHERE flaky_score > 0"))?.n ?? 0,
    costMonth: (await one<{ n: number }>("SELECT COALESCE(SUM(CAST(json_extract(cost,'$.cost_usd') AS REAL)),0) n FROM runs WHERE created_at > ?",
      [new Date(Date.now() - 30 * 864e5).toISOString()]))?.n ?? 0,
    emailsSent: (await one<{ n: number }>("SELECT COUNT(*) n FROM email_messages WHERE status='sent' AND created_at > ?",
      [new Date(Date.now() - 30 * 864e5).toISOString()]))?.n ?? 0,
    durationP95: pct(durations, 0.95),
    passTrend: passTrend.slice(-14),
    runDurations: [{ label: "p50", p50: pct(durations, 0.5), p95: 0 }, { label: "p95", p50: 0, p95: pct(durations, 0.95) }],
    categories,
    slowest,
    flakyTop,
    recentRuns: recentRuns as RecentRun[],
    attentionRuns: attentionRuns as RecentRun[],
    queueDepth: (await one<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE status IN ('CREATED','QUEUED','CLONING','ANALYZING','SCAFFOLDING','PLANNING','GENERATING','VALIDATING','HEALING','PROVISIONING','EXECUTING','ANALYZING_RESULTS','REPORTING','NOTIFYING','COMMITTING')"))?.n ?? 0,
    runnerActive: (await one<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE status='EXECUTING'"))?.n ?? 0,
  };
  return result;
}

/**
 * Jalankan query run list. `suffix` boleh berupa:
 *  - "WHERE a = b ORDER BY ..."   → dipakai apa adanya
 *  - "ORDER BY ... / LIMIT ..."   → tanpa klausa WHERE
 */
export async function allRunRows(suffix = "", args: Array<string> = []): Promise<RecentRun[]> {
  const body = suffix.replace(/^WHERE\s+/i, "").trim();
  const clause = !body || /^(ORDER|LIMIT|GROUP)\b/i.test(body) ? suffix : `WHERE ${body}`;
  const rows = await all<RecentRun>(
    `SELECT r.id, r.project_id, p.name project_name, e.name env_name, r.status, r.commit_sha, r.branch, r.trigger,
            r.created_at, r.finished_at, r.summary, r.cost, r.report_url
     FROM runs r JOIN projects p ON p.id = r.project_id LEFT JOIN environments e ON e.id = r.environment_id
     ${clause}`, args,
  );
  return rows.map((r) => ({ ...r, summary: J.parse<RunSummary | null>(r.summary, null), cost: J.parse(r.cost, null) }));
}

export async function projectById(id: string): Promise<(Record<string, any> & { runs: RecentRun[] }) | null> {
  const p = await one<Record<string, any>>("SELECT * FROM projects WHERE id = ?", [id]);
  if (!p) return null;
  return {
    ...(p as Record<string, any>),
    settings: J.parse<Record<string, unknown>>(p.settings, {}),
    detected: J.parse<Record<string, unknown> | null>(p.detected, null),
    environments: await all("SELECT * FROM environments WHERE project_id = ?", [id]),
    recipients: await all("SELECT * FROM recipients WHERE project_id = ?", [id]),
    runs: await allRunRows("WHERE r.project_id = ? ORDER BY r.created_at DESC LIMIT 20", [id]),
  };
}

export async function runDetail(id: string): Promise<(Record<string, any> & { summary: RunSummary | null }) | null> {
  const run = await one<Record<string, any>>(
    `SELECT r.*, p.name project_name, e.name env_name, e.base_url FROM runs r
     JOIN projects p ON p.id = r.project_id LEFT JOIN environments e ON e.id = r.environment_id WHERE r.id = ?`, [id]);
  if (!run) return null;
  return {
    ...run,
    summary: J.parse<RunSummary | null>(run.summary, null),
    cost: J.parse<Record<string, number> | null>(run.cost, null),
    steps: await all("SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq", [id]),
    tests: (await all<Record<string, any>>("SELECT * FROM test_results WHERE run_id = ? ORDER BY status DESC, duration_ms DESC", [id]))
      .map<Record<string, any>>((r) => ({ ...r, tags: J.parse<string[]>(r.tags, []), covers: J.parse<string[]>(r.covers, []) })),
    diagrams: await all("SELECT * FROM diagrams WHERE run_id = ? ORDER BY in_email DESC, kind", [id]),
    shards: J.parse<Array<{ index: number; total: number; testIds: string[]; estimatedMs: number }>>(await kvGet(`shards:${id}`), []),
    pr: J.parse<{ number: number; url: string; title: string } | null>(await kvGet(`pr:${id}`), null),
    logs: (await all("SELECT * FROM run_logs WHERE run_id = ? ORDER BY id DESC LIMIT 300", [id])).reverse(),
    findings: await all("SELECT * FROM arch_findings WHERE snapshot_id = (SELECT id FROM arch_snapshots WHERE run_id = ?) LIMIT 12", [id]),
    devops: await all("SELECT * FROM devops_findings WHERE run_id = ? LIMIT 12", [id]),
    coverage: await all("SELECT * FROM node_coverage WHERE run_id = ? ORDER BY tests_total DESC, node_id LIMIT 40", [id]),
    snapshot: await one("SELECT id, node_count, edge_count, extractor_status, created_at FROM arch_snapshots WHERE run_id = ?", [id]),
  };
}
