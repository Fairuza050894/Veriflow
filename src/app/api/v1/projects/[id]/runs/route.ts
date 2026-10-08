import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { createRun, advanceRun } from "@/lib/pipeline/engine";
import { notFound, problem } from "@/lib/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/projects/{id}/runs — trigger run (manual / API key / webhook).
 * `Idempotency-Key` header.opsional: run yang sama tidak pernah dibuat dua kali (FR-ORC-03).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await one<{ id: string }>("SELECT id FROM projects WHERE id = ?", [id]))) return notFound("Project tidak ditemukan");

  const parsed = z.object({
    environment: z.string().min(1).optional(), environment_id: z.string().min(1).optional(),
    mode: z.enum(["FULL_AUTO", "REVIEW_GATE", "REPORT_ONLY"]).optional(),
    idempotency_key: z.string().min(1).max(200).optional(), trigger: z.enum(["manual", "schedule", "webhook"]).optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return problem(422, "Input run tidak valid");
  const body = parsed.data;
  const idem = req.headers.get("idempotency-key") ?? body.idempotency_key;

  const envId = body.environment_id ?? body.environment
    ?? (await one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? ORDER BY id DESC LIMIT 1", [id]))?.id;
  if (!envId) return problem(422, "Project belum punya environment");
  if (!(await one("SELECT id FROM environments WHERE id = ? AND project_id = ?", [envId, id]))) return problem(422, "Environment bukan milik project");

  const { runId, duplicate, reportToken } = await createRun({
    projectId: id,
    environmentId: envId,
    trigger: body.trigger ?? "manual",
    mode: body.mode,
    idempotencyKey: idem,
  });

  advanceRun(runId).catch(() => {});

  const reportLink = reportToken ? `/r/${reportToken}` : null;
  return NextResponse.json(
    { run_id: runId, project_id: id, duplicate, stream: `/api/v1/runs/${runId}/stream`, report: reportLink },
    { status: duplicate ? 200 : 202 },
  );
}

/** GET /api/v1/projects/{id}/runs — histori run. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const runs = (await one<{ n: number }>("SELECT COUNT(*) n FROM runs WHERE project_id = ?", [id]))?.n ?? 0;
  const { allRunRows } = await import("@/lib/queries");
  return NextResponse.json({ total: runs, runs: await allRunRows("WHERE r.project_id = ? ORDER BY r.created_at DESC LIMIT 50", [id]) });
}
