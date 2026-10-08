import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { cancelRun } from "@/lib/pipeline/actions";
import { notFound } from "@/lib/http";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/v1/runs/{id}/cancel — FR-EXE-05 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await one<{ id: string }>("SELECT id FROM runs WHERE id = ?", [id]))) return notFound("Run tidak ditemukan");
  return NextResponse.json(await cancelRun(id));
}

/** GET /api/v1/runs/{id}/logs — buffer log untuk klien non-SSE. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ lines: (await all("SELECT * FROM run_logs WHERE run_id = ? ORDER BY id DESC LIMIT 200", [id])).reverse() });
}
