import { NextResponse } from "next/server";
import { decideReview } from "@/lib/pipeline/actions";
import { notFound, problem } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/runs/{id}/approve — Review Center (FR-DSH-06). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { reviewer?: string; comments?: string };
  try {
    const res = await decideReview(id, "approve", body.reviewer ?? "engineer");
    return NextResponse.json({ ...res, approved: true });
  } catch (e) {
    return problem(409, (e as Error).message);
  }
}