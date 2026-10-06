import { NextResponse } from "next/server";
import { all, one } from "@/lib/db";
import { notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/runs/{id}/tests — Test Explorer dengan filter (FR-DSH-04). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await one<{ id: string }>("SELECT id FROM runs WHERE id = ?", [id]))) return notFound("Run tidak ditemukan");

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const layer = url.searchParams.get("layer");
  const tag = url.searchParams.get("tag");
  const file = url.searchParams.get("file");
  const category = url.searchParams.get("category");
  const minMs = Number(url.searchParams.get("min_ms") ?? 0);

  const where: string[] = ["run_id = ?"];
  const args: Array<string | number> = [id];
  if (status) { where.push("status = ?"); args.push(status); }
  if (layer) { where.push("layer = ?"); args.push(layer); }
  if (file) { where.push("file LIKE ?"); args.push(`%${file}%`); }
  if (category) { where.push("error_category = ?"); args.push(category); }
  if (minMs) { where.push("duration_ms >= ?"); args.push(minMs); }

  let rows = await all<Record<string, any>>(
    `SELECT * FROM test_results WHERE ${where.join(" AND ")} ORDER BY duration_ms DESC`, args);
  if (tag) rows = rows.filter((r) => JSON.parse(String(r.tags ?? "[]")).includes(tag));

  return NextResponse.json({
    total: rows.length,
    tests: rows.map((r) => ({ ...r, tags: JSON.parse(String(r.tags ?? "[]")), covers: JSON.parse(String(r.covers ?? "[]")) })),
  });
}