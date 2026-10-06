import { NextResponse } from "next/server";
import { one, all, J } from "@/lib/db";
import { notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/runs/{id} — status + summary + step timeline. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = one<Record<string, any>>(
    `SELECT r.*, p.name project_name, e.name env_name FROM runs r
     JOIN projects p ON p.id = r.project_id LEFT JOIN environments e ON e.id = r.environment_id WHERE r.id = ?`, [id]);
  if (!r) return notFound("Run tidak ditemukan");
  // Report link uses runId; public report page accepts both token and runId
  return NextResponse.json({
    ...r,
    summary: J.parse(r.summary, null),
    cost: J.parse(r.cost, null),
    steps: all("SELECT * FROM run_steps WHERE run_id = ? ORDER BY seq", [id]),
    report_link: `/r/${id}`,
  });
}