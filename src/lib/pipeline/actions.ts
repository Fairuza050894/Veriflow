import { all, one, run as dbRun, kvGet, nowIso, sha256, J } from "../db";
import { advanceRun, log, setStatus } from "./engine";
import type { RunSummary } from "../types";
import { maskSecrets } from "../mailer";

/** BP-10 — approve / reject pada mode REVIEW-GATE. */
export async function decideReview(runId: string, decision: "approve" | "reject", reviewer = "engineer") {
  const run = await one<{ mode: string }>("SELECT mode FROM runs WHERE id = ?", [runId]);
  if (!run) throw new Error("run tidak ditemukan");
  const step = await one<{ status: string }>(
    "SELECT status FROM run_steps WHERE run_id=? AND name='WAITING_APPROVAL'", [runId]);
  if (!step || step.status !== "running") throw new Error("run tidak sedang menunggu persetujuan");

  dbRun(
    "UPDATE run_steps SET status=?, finished_at=?, detail=? WHERE run_id=? AND name='WAITING_APPROVAL'",
    [decision === "approve" ? "succeeded" : "cancelled", nowIso(), JSON.stringify({ reviewer, decision, at: nowIso() }), runId],
  );

  if (decision === "reject") {
    log(runId, "WAITING_APPROVAL", `${reviewer} menolak hasil generate`);
    setStatus(runId, "CANCELLED", { finished_at: nowIso() });
    dbRun("UPDATE run_steps SET status='cancelled' WHERE run_id=? AND status IN ('pending','running')", [runId]);
    log(runId, "engine", "Run dibatalkan oleh pengguna");
    return { status: "CANCELLED" as const };
  }

  log(runId, "WAITING_APPROVAL", `${reviewer} menyetujui hasil generate`);
  return advanceRun(runId);
}

export function cancelRun(runId: string) {
  setStatus(runId, "CANCELLED", { finished_at: nowIso() });
  dbRun("UPDATE run_steps SET status='cancelled' WHERE run_id=? AND status IN ('pending','running')", [runId]);
  log(runId, "engine", "Run dibatalkan oleh pengguna");
  return { status: "CANCELLED" as const };
}

// reportTokenFor: get token from database (only hash stored, raw token not persisted)
export const reportTokenFor = (runId: string): string | null => {
  const link = one<{ token_hash: string }>("SELECT token_hash FROM report_links WHERE run_id = ? AND revoked_at IS NULL", [runId]);
  if (!link) return null;
  // We can't reconstruct the raw token from hash. For API responses at creation time,
  // the token is returned directly from createRun. For later lookups, use the hash.
  // This function is kept for compatibility but returns null.
  return null;
};

/** Report read-only untuk customer via signed link (FR-RPT-07). */
export async function publicReportByToken(token: string) {
  const link = await one<{ run_id: string }>(
    "SELECT run_id FROM report_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    [sha256(token), nowIso()],
  );
  if (!link) return null;
  return buildPublicReport(link.run_id);
}

/** Report read-only via runId (fallback when token not available). */
export async function publicReportByRunId(runId: string) {
  const link = await one<{ run_id: string }>(
    "SELECT run_id FROM report_links WHERE run_id = ? AND revoked_at IS NULL AND expires_at > ?",
    [runId, nowIso()],
  );
  if (!link) return null;
  return buildPublicReport(link.run_id);
}

/** Shared logic to build public report data. */
async function buildPublicReport(runId: string) {
  const run = await one<{ id: string; project_id: string; commit_sha: string; branch: string; mode: string; created_at: string; finished_at: string | null }>(
    "SELECT id, project_id, commit_sha, branch, mode, created_at, finished_at FROM runs WHERE id = ?", [runId],
  );
  if (!run) return null;
  const project = await one<{ name: string }>("SELECT name FROM projects WHERE id = ?", [run.project_id]);
  const env = await one<{ name: string }>(
    "SELECT e.name FROM environments e JOIN runs r ON r.environment_id = e.id WHERE r.id = ?", [runId]);
  const summary = J.parse<RunSummary | null>(kvGet(`summary:${runId}`), null);
  const diagrams = await all<{ kind: string; title: string; syntax: string; source: string; alt_text: string | null; status: string }>(
    "SELECT kind, title, syntax, source, alt_text, status FROM diagrams WHERE run_id = ? ORDER BY kind", [runId],
  );
  const topFailures = await all<{ title: string; file: string; status: string; error_category: string | null; error_message: string | null }>(
    "SELECT title, file, status, error_category, error_message FROM test_results WHERE run_id = ? AND status IN ('failed','flaky') LIMIT 10", [runId],
  );
  const findings = await all<{ code: string; severity: string; title: string; detail: string; sensitive: number; internal_only: number }>(
    "SELECT code, severity, title, detail, sensitive, internal_only FROM arch_findings WHERE snapshot_id = (SELECT id FROM arch_snapshots WHERE run_id = ?) LIMIT 6", [runId],
  );
  // Cakupan: sembunyikan node database (db:*) untuk audiens customer
  const coverage = await all<{ node_id: string; state: string; tests_total: number }>(
    "SELECT node_id, state, tests_total FROM node_coverage WHERE run_id = ? AND tests_total > 0 AND node_id NOT LIKE 'db:%'", [runId]);

  // Redaksi untuk audiens customer: hilangkan temuan sensitif/internal_only
  const redactedFindings = findings
    .filter((f) => !(f.sensitive === 1 || f.internal_only === 1))
    .map((f) => ({ code: f.code, severity: f.severity, title: f.title, detail: maskSecrets(f.detail) }));

  // Mask secrets di pesan error
  const maskedFailures = topFailures.map((f) => ({
    ...f,
    error_message: f.error_message ? maskSecrets(f.error_message) : null,
  }));

  return { run, project, env, summary, diagrams, topFailures: maskedFailures, findings: redactedFindings, coverage };
}

export function snapshotDiff(fromRun: string, toRun: string) {
  const a = J.parse<{ nodes: Array<{ id: string }> } | null>(kvGet(`arch:${fromRun}`), null);
  const b = J.parse<{ nodes: Array<{ id: string }> } | null>(kvGet(`arch:${toRun}`), null);
  if (!a || !b) return null;
  const av = new Set(a.nodes.map((n) => n.id));
  const bv = new Set(b.nodes.map((n) => n.id));
  return {
    added: [...bv].filter((id) => !av.has(id)),
    removed: [...av].filter((id) => !bv.has(id)),
    kept: [...bv].filter((id) => av.has(id)).length,
  };
}

export async function resendEmail(runId: string, kind: string = "report") {
  const run = await one<Record<string, any>>(
    `SELECT r.*, p.name project_name, e.name env_name FROM runs r
     JOIN projects p ON p.id = r.project_id LEFT JOIN environments e ON e.id = r.environment_id WHERE r.id = ?`, [runId]);
  if (!run) throw new Error("Run tidak ditemukan");

  const summary = J.parse<RunSummary | null>(run.summary, null);
  if (!summary) throw new Error("Run belum punya hasil untuk dilaporkan");

  const recips = await all<{ email: string; locale: string }>(
    "SELECT email, locale FROM recipients WHERE project_id = ? AND unsubscribed_at IS NULL", [run.project_id]);
  const targets = recips.length ? recips : [{ email: "qa@example.com", locale: "id" }];

  const diagrams = await all<{ kind: string; title: string; alt_text: string | null; in_email: number }>(
    "SELECT kind, title, alt_text, in_email FROM diagrams WHERE run_id = ? AND in_email = 1", [runId]);

  // Biarkan pipeline tetap sinkron supaya laporan terisi penuh.
  await advanceRun(runId);

  const sentTo: string[] = [];
  for (const [i, r] of targets.entries()) {
    const { buildReportEmail } = await import("../report");
    const { sendEmail } = await import("../mailer");
    const email = buildReportEmail({
      runId: `${runId}#resend${i}`,
      projectName: String(run.project_name),
      envName: String(run.env_name ?? "default"),
      commit: String(run.commit_sha ?? ""),
      branch: String(run.branch ?? ""),
      summary,
      diagrams: diagrams.map((d) => ({ kind: d.kind as never, title: d.title, alt_text: d.alt_text, in_email: 1, audience: "customer" as const })),
      reportUrl: String(run.report_url ?? ""),
      locale: r.locale === "en" ? "en" : "id",
    });
    const res = await sendEmail({
      runId: `${runId}#resend${i}`,
      kind: "report",
      to: r.email,
      locale: r.locale === "en" ? "en" : "id",
      ...email,
    });
    sentTo.push(r.email);
    void res;
  }
  return { ok: true, sentTo, count: sentTo.length };
}