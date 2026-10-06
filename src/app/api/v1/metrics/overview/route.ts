import { NextResponse } from "next/server";
import { overview } from "@/lib/queries";
import { ensureSeeded } from "@/lib/queries";
import { problem } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/metrics/overview — data untuk KPI dashboard (FR-DSH-01). */
export async function GET() {
  ensureSeeded();
  return NextResponse.json(overview());
}

/** POST tidak dilayani (endpoint baca saja). */
export async function POST() {
  return problem(405, "Gunakan GET");
}