import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/queries";
import { POST as quickRun } from "./quick-run/route";

export const dynamic = "force-dynamic";

/** GET /api/v1/projects */
export async function GET() {
  ensureSeeded();
  const rows = await all<Record<string, unknown>>(
    "SELECT id, org_id, name, repo_provider, repo_url, default_branch, subfolder, mode, scaffold_root, settings, detected, created_at FROM projects ORDER BY created_at DESC");
  return NextResponse.json({
    projects: rows.map((p) => ({
      ...p,
      settings: JSON.parse(String(p.settings ?? "{}")),
      detected: p.detected ? JSON.parse(String(p.detected)) : null,
    })),
  });
}

/** POST /api/v1/projects — buat project dari repo_url (kontrak sama dengan quick-run). */
export const POST = (req: Request) => quickRun(req);