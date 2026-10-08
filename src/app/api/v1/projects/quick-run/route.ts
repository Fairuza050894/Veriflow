import { NextResponse } from "next/server";
import { all, one, run as dbRun, uid, nowIso, tx } from "@/lib/db";
import { createRun, advanceRun } from "@/lib/pipeline/engine";
import { repoNameFromUrl } from "@/lib/util";
import { ensureSeeded } from "@/lib/queries";
import { problem } from "@/lib/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  repo_url: z.string().regex(/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "repo_url harus berupa URL GitHub HTTPS valid"),
  branch: z.string().regex(/^[\w./-]{1,100}$/, "branch tidak valid").default("main"),
  base_url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "base_url harus HTTP atau HTTPS").optional(),
  subfolder: z.string().max(500).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "subfolder harus berada di dalam repository").optional(),
  recipients: z.array(z.string().email()).max(100).default([]),
  extra_recipients: z.array(z.string().email()).max(100).default([]),
  mode: z.enum(["FULL_AUTO", "REVIEW_GATE", "REPORT_ONLY"]).optional(),
  idempotency_key: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/v1/projects/quick-run — satu panggilan: buat project (bila belum ada)
 * + environment + penerima + mulai run. Alur "ketik repo → langsung jalan".
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return problem(400, "Body harus berupa JSON valid");
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return problem(422, "Input quick-run tidak valid", { errors: parsed.error.flatten() });
  const body = parsed.data;
  const { branch } = body;
  const targets = [...new Set([...body.recipients, ...body.extra_recipients])];
  if (!targets.length) targets.push("qa@example.com");
  await ensureSeeded();

  const orgId = (await one<{ id: string }>("SELECT id FROM organizations LIMIT 1"))?.id;
  if (!orgId) return problem(500, "Organisasi belum ada (jalankan seed)");

  const result = await tx(async () => {
  const name = repoNameFromUrl(body.repo_url);
  let project = await one<{ id: string }>("SELECT id FROM projects WHERE repo_url = ? AND org_id = ?", [body.repo_url, orgId]);

  if (!project) {
    const id = uid("prj_");
    await dbRun(
      `INSERT INTO projects(id, org_id, name, repo_provider, repo_url, default_branch, subfolder, mode, scaffold_root, settings, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [id, orgId, name, "github", body.repo_url, body.branch ?? "main", body.subfolder ?? null,
        body.mode ?? "FULL_AUTO", "autoqa", JSON.stringify({ max_tests_per_run: 60 }), nowIso()],
    );
    project = { id };
  }

  if (body.idempotency_key) {
    const existing = await one<{ id: string; environment_id: string; report_url: string | null }>(
      "SELECT id, environment_id, report_url FROM runs WHERE idempotency_key = ?", [`${project.id}:${body.idempotency_key}`]);
    if (existing) return { projectId: project.id, envId: existing.environment_id, runId: existing.id, duplicate: true,
      reportToken: existing.report_url?.split("/r/")[1] };
  }
  const existingEnv = await one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? AND base_url = ? AND name = 'staging' LIMIT 1",
    [project.id, body.base_url ?? "http://localhost:3000"]);
  const envId = existingEnv?.id ?? uid("env_");
  if (!existingEnv) {
  await dbRun(
    "INSERT INTO environments(id, project_id, name, base_url, api_base_url, auth_strategy, read_only) VALUES(?,?,?,?,?,?,?)",
    [envId, project.id, "staging", body.base_url ?? "http://localhost:3000", body.base_url ?? "http://localhost:3000", "bearer", 0],
  );
  }

  for (const email of targets) {
    if (await one("SELECT id FROM recipients WHERE project_id = ? AND lower(email) = lower(?)", [project.id, email])) continue;
    await dbRun("INSERT INTO recipients(id, project_id, email, kind, locale, verified_at) VALUES(?,?,?,?,?,?)",
      [uid("rcp_"), project.id, email, "to", "id", nowIso()]);
  }

  const run = await createRun({
    projectId: project.id,
    environmentId: envId,
    trigger: "manual",
    mode: body.mode,
    idempotencyKey: body.idempotency_key,
    branch,
  });
  return { ...run, projectId: project.id, envId };
  });
  const { runId, duplicate, reportToken, projectId, envId } = result;

  // Dijalankan sekali agar UI langsung punya progres; SSE melengkapi sisanya.
  advanceRun(runId).catch(() => {});

  const reportLink = reportToken ? `/r/${reportToken}` : null;
  return NextResponse.json(
    { project_id: projectId, run_id: runId, duplicate, stream: `/api/v1/runs/${runId}/stream`, environment_id: envId, recipients: targets, report: reportLink },
    { status: duplicate ? 200 : 202 },
  );
}

export async function GET() {
  await ensureSeeded();
  const rows = await all<Record<string, unknown>>(
    "SELECT id, name, repo_url, mode, default_branch, created_at FROM projects ORDER BY created_at DESC");
  return NextResponse.json({ projects: rows });
}
