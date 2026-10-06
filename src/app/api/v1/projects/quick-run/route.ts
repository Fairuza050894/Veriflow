import { NextResponse } from "next/server";
import { all, one, run as dbRun, uid, nowIso } from "@/lib/db";
import { createRun, advanceRun } from "@/lib/pipeline/engine";
import { repoNameFromUrl } from "@/lib/util";
import { ensureSeeded } from "@/lib/queries";
import { problem } from "@/lib/http";

export const dynamic = "force-dynamic";

type Body = {
  repo_url?: string; branch?: string; base_url?: string; subfolder?: string;
  recipients?: string[]; mode?: string; environment_id?: string; token?: string;
  idempotency_key?: string; extra_recipients?: string[];
};

/**
 * POST /api/v1/projects/quick-run — satu panggilan: buat project (bila belum ada)
 * + environment + penerima + mulai run. Alur "ketik repo → langsung jalan".
 */
export async function POST(req: Request) {
  ensureSeeded();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return problem(400, "Body harus berupa JSON valid");
  }
  if (!body.repo_url || !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(body.repo_url)) {
    return problem(422, "repo_url harus berupa URL GitHub HTTPS valid (https://github.com/owner/repo)");
  }

  // Validasi branch: alphanumeric, dash, underscore, dot, slash, max 100 chars
  const branch = body.branch ?? "main";
  if (!/^[\w./-]{1,100}$/.test(branch)) {
    return problem(422, "branch tidak valid (hanya alfanumerik, -, _, ., /, max 100 karakter)");
  }

  const orgId = (await one<{ id: string }>("SELECT id FROM organizations LIMIT 1"))?.id;
  if (!orgId) return problem(500, "Organisasi belum ada (jalankan seed)");

  const name = repoNameFromUrl(body.repo_url);
  let project = await one<{ id: string }>("SELECT id FROM projects WHERE repo_url = ? AND org_id = ?", [body.repo_url, orgId]);

  if (!project) {
    const id = uid("prj_");
    dbRun(
      `INSERT INTO projects(id, org_id, name, repo_provider, repo_url, default_branch, subfolder, mode, scaffold_root, settings, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [id, orgId, name, "github", body.repo_url, body.branch ?? "main", body.subfolder ?? null,
        body.mode ?? "FULL_AUTO", "autoqa", JSON.stringify({ max_tests_per_run: 60 }), nowIso()],
    );
    project = { id };
  }

  const envId = uid("env_");
  dbRun(
    "INSERT INTO environments(id, project_id, name, base_url, api_base_url, auth_strategy, read_only) VALUES(?,?,?,?,?,?,?)",
    [envId, project.id, "staging", body.base_url ?? "http://localhost:3000", body.base_url ?? "http://localhost:3000", "bearer", 0],
  );

  const targets = [...(body.recipients ?? []), ...(body.extra_recipients ?? [])];
  for (const email of (targets.length ? targets : ["qa@example.com"])) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return problem(422, `Alamat penerima tidak valid: ${email}`);
    dbRun("INSERT INTO recipients(id, project_id, email, kind, locale, verified_at) VALUES(?,?,?,?,?,?)",
      [uid("rcp_"), project.id, email, "to", "id", nowIso()]);
  }

  const { runId, duplicate, reportToken } = await createRun({
    projectId: project.id,
    environmentId: envId,
    trigger: "manual",
    mode: body.mode,
    idempotencyKey: body.idempotency_key,
    branch,
  });

  // Dijalankan sekali agar UI langsung punya progres; SSE melengkapi sisanya.
  advanceRun(runId).catch(() => {});

  const reportLink = reportToken ? `/r/${reportToken}` : `/r/${runId}`;
  return NextResponse.json(
    { project_id: project.id, run_id: runId, duplicate, stream: `/api/v1/runs/${runId}/stream`, environment_id: envId, recipients: targets, report: reportLink },
    { status: duplicate ? 200 : 202 },
  );
}

export async function GET() {
  ensureSeeded();
  const rows = await all<Record<string, unknown>>(
    "SELECT id, name, repo_url, mode, default_branch, created_at FROM projects ORDER BY created_at DESC");
  return NextResponse.json({ projects: rows });
}