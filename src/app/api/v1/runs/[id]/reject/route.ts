import { NextResponse } from "next/server";
import { decideReview } from "@/lib/pipeline/actions";
import { problem } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/runs/{id}/reject — Review Center. Komentar jadi feedback untuk agent. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { reviewer?: string; comments?: string };
  try {
    const res = await decideReview(id, "reject", body.reviewer ?? "engineer");
    return NextResponse.json({ ...res, approved: false, comments: body.comments ?? null });
  } catch (e) {
    return problem(409, (e as Error).message);
  }
}