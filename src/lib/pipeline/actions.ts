import { all, one, run as dbRun, kvGet, nowIso, sha256, J } from "../db";
import { advanceRun, log, setStatus } from "./engine";
import type { RunSummary } from "../types";

/** BP-10 — approve / reject pada mode REVIEW-GATE. */
export async function decideReview(runId: string, decision: "approve" | "reject", reviewer = "engineer") {
  const run = one<{ mode: string }>("SELECT mode FROM runs WHERE id = ?", [runId]);
  if (!run) throw new Error("run tidak ditemukan");
  const step = one<{ status: string }>(
    "SELECT status FROM run_steps WHERE run_id=? AND name='WAITING_APPROVAL'", [runId]);
  if (!step || step.status !== "running") throw new Error("run tidak sedang menunggu persetujuan");

  dbRun(
    "UPDATE run_steps SET status=?, finished_at=?, detail=? WHERE run_id=? AND name='WAITING_APPROVAL'",
    [decision === "approve" ? "succeeded" : "cancelled", nowIso(), JSON.stringify({ reviewer, decision, at: nowIso() }), runId],
  );

  if (decision === "reject") {
    log(runId, "WAITING_APPROVAL", `${reviewer} menolak hasil generate`);
    setStatus(runId, "CANCELLED", { finished_at: nowIso() });
    return { status: "CANCELLED" as const };
  }
  log(runId, "WAITING_APPROVAL", `${reviewer} menyetujui hasil generate`);
  return advanceRun(runId);
}

/** FR-EXE-05 — cancel graceful. */
export function cancelRun(runId: string) {
  setStatus(runId, "CANCELLED", { finished_at: nowIso() });
  dbRun("UPDATE run_steps SET status='cancelled' WHERE run_id=? AND status IN ('pending','running')", [runId]);
  log(runId, "engine", "Run dibatalkan oleh pengguna");
  return { status: "CANCELLED" as const };
}

export const reportTokenFor = (runId: string) => kvGet(`report_token:${runId}`);

/** Report read-only untuk customer via signed link (FR-RPT-07). */
export function publicReportByToken(token: string) {
  const link = one<{ run_id: string }>(
    "SELECT run_id FROM report_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    [sha256(token), nowIso()],
  );
  if (!link) return null;

  const run = one<{ id: string; project_id: string; commit_sha: string; branch: string; mode: string; created_at: string; finished_at: string | null }>(
    "SELECT id, project_id, commit_sha, branch, mode, created_at, finished_at FROM runs WHERE id = ?", [link.run_id],
  );
  if (!run) return null;
  const project = one<{ name: string }>("SELECT name FROM projects WHERE id = ?", [run.project_id]);
  const env = one<{ name: string }>(
    "SELECT e.name FROM environments e JOIN runs r ON r.environment_id = e.id WHERE r.id = ?", [link.run_id]);
  const summary = J.parse<RunSummary | null>(kvGet(`summary:${link.run_id}`), null);
  const diagrams = all<{ kind: string; title: string; syntax: string; source: string; alt_text: string | null; status: string }>(
    "SELECT kind, title, syntax, source, alt_text, status FROM diagrams WHERE run_id = ? ORDER BY kind", [link.run_id],
  );
  const topFailures = all<{ title: string; file: string; status: string; error_category: string | null; error_message: string | null }>(
    "SELECT title, file, status, error_category, error_message FROM test_results WHERE run_id = ? AND status IN ('failed','flaky') LIMIT 10", [link.run_id],
  );
  const findings = all<{ code: string; severity: string; title: string; detail: string }>(
    "SELECT code, severity, title, detail FROM arch_findings WHERE snapshot_id = (SELECT id FROM arch_snapshots WHERE run_id = ?) LIMIT 6", [link.run_id],
  );
  // cakupan per node (untuk ringkasan teks di email/laporan publik)
  const coverage = all<{ node_id: string; state: string; tests_total: number }>(
    "SELECT node_id, state, tests_total FROM node_coverage WHERE run_id = ? AND tests_total > 0", [link.run_id]);

  return { run, project, env, summary, diagrams, topFailures, findings, coverage };
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