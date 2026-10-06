import { NextResponse } from "next/server";
import { one, all, J } from "@/lib/db";
import { notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/projects/{id} — detail + hasil auto-detect. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = one<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [id]);
  if (!p) return notFound("Project tidak ditemukan");
  return NextResponse.json({
    ...p,
    settings: J.parse<Record<string, unknown>>(p.settings, {}),
    detected: J.parse<Record<string, unknown> | null>(p.detected, null),
    environments: all("SELECT * FROM environments WHERE project_id = ?", [id]),
    recipients: all("SELECT * FROM recipients WHERE project_id = ?", [id]),
  });
}