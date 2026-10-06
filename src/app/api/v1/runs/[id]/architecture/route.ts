import { NextResponse } from "next/server";
import { all, one, J } from "@/lib/db";
import { notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/runs/{id}/architecture — ringkasan snapshot + daftar diagram (FR-DGM-01). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const snap = one<Record<string, any>>("SELECT * FROM arch_snapshots WHERE run_id = ?", [id]);
  if (!snap) return notFound("Snapshot arsitektur belum tersedia untuk run ini");

  const model = J.parse<{ nodes: unknown[]; edges: unknown[] } | null>(snap.model, null);
  return NextResponse.json({
    snapshot: {
      id: snap.id,
      commit_sha: snap.commit_sha,
      node_count: snap.node_count,
      edge_count: snap.edge_count,
      extractor_status: J.parse<unknown[]>(snap.extractor_status, []),
      created_at: snap.created_at,
    },
    model,
    diagrams: all("SELECT id, kind, title, audience, syntax, source, node_count, truncated, ai_summary, status, in_email, alt_text FROM diagrams WHERE run_id = ? ORDER BY kind", [id]),
    coverage: all("SELECT node_id, kind, tests_total, passed, failed, flaky, state FROM node_coverage WHERE run_id = ?", [id]),
    findings: all("SELECT code, severity, title, detail, nodes, evidence FROM arch_findings WHERE snapshot_id = ?", [snap.id]),
  });
}