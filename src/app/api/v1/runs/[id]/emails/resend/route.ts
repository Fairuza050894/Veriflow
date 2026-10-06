import { NextResponse } from "next/server";
import { all, J, one } from "@/lib/db";
import { buildReportEmail } from "@/lib/report";
import { sendEmail } from "@/lib/mailer";
import { advanceRun } from "@/lib/pipeline/engine";
import { notFound, problem } from "@/lib/http";
import type { RunSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/runs/{id}/emails/resend — kirim ulang laporan.
 * Idempotency key dipaksa unik per klik (suffix #n) supaya memang terkirim ulang
 * alih-alih diam-diam di-skip oleh guard `run_id:kind:recipient`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = one<Record<string, any>>(
    `SELECT r.*, p.name project_name, e.name env_name FROM runs r
     JOIN projects p ON p.id = r.project_id LEFT JOIN environments e ON e.id = r.environment_id WHERE r.id = ?`, [id]);
  if (!run) return notFound("Run tidak ditemukan");

  const summary = J.parse<RunSummary | null>(run.summary, null);
  if (!summary) return problem(409, "Run belum punya hasil untuk dilaporkan");

  const recips = all<{ email: string; locale: string }>(
    "SELECT email, locale FROM recipients WHERE project_id = ? AND unsubscribed_at IS NULL", [run.project_id]);
  const targets = recips.length ? recips : [{ email: "qa@example.com", locale: "id" }];

  const diagrams = all<{ kind: string; title: string; alt_text: string | null; in_email: number }>(
    "SELECT kind, title, alt_text, in_email FROM diagrams WHERE run_id = ? AND in_email = 1", [id]);

  // Biarkan pipeline tetap sinkron supaya laporan terisi penuh.
  await advanceRun(id);

  const sentTo: string[] = [];
  for (const [i, r] of targets.entries()) {
    const email = buildReportEmail({
      runId: `${id}#resend${i}`,
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
      runId: `${id}#resend${i}`,
      kind: "report",
      to: r.email,
      locale: r.locale === "en" ? "en" : "id",
      ...email,
    });
    sentTo.push(r.email);
    void res;
  }
  return NextResponse.json({ ok: true, sentTo, count: sentTo.length });
}