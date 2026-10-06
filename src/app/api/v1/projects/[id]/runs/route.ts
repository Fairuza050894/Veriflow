import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { createRun, advanceRun } from "@/lib/pipeline/engine";
import { notFound, problem } from "@/lib/http";
import { reportTokenFor } from "@/lib/pipeline/actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/projects/{id}/runs — trigger run (manual / API key / webhook).
 * `Idempotency-Key` header.opsional: run yang sama tidak pernah dibuat dua kali (FR-ORC-03).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!one<{ id: string }>("SELECT id FROM projects WHERE id = ?", [id])) return notFound("Project tidak ditemukan");

  const body = (await req.json().catch(() => ({}))) as {
    environment?: string; environment_id?: string; mode?: string;
    extra_recipients?: string[]; idempotency_key?: string; trigger?: string;
  };
  const idem = req.headers.get("idempotency-key") ?? body.idempotency_key;

  const envId = body.environment_id ?? body.environment
    ?? one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", [id])?.id;
  if (!envId) return problem(422, "Project belum punya environment");

  const { runId, duplicate } = await createRun({
    projectId: id,
    environmentId: envId,
    trigger: body.trigger ?? "manual",
    mode: body.mode,
    idempotencyKey: idem,
  });

  advanceRun(runId).catch(() => {});

  return NextResponse.json(
    { run_id: runId, project_id: id, duplicate, stream: `/api/v1/runs/${runId}/stream`, report: `/r/${reportTokenFor(runId)}` },
    { status: duplicate ? 200 : 202 },
  );
}

/** GET /api/v1/projects/{id}/runs — histori run. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runs = one<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE project_id = ?", [id])?.n ?? 0;
  const { allRunRows } = await import("@/lib/queries");
  return NextResponse.json({ total: runs, runs: allRunRows("WHERE r.project_id = ? ORDER BY r.created_at DESC LIMIT 50", [id]) });
}