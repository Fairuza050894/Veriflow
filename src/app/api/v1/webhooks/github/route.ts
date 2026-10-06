import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { all, one, run as dbRun, nowIso, uid } from "@/lib/db";
import { createRun, advanceRun } from "@/lib/pipeline/engine";
import { problem } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/github — terima event push / pull_request.
 * Keamanan: verifikasi HMAC SHA-256 dengan secret + dedupe delivery-id (Arsitektur §12).
 * Bentukkan idempotency key `repo+commit+trigger` supaya webhook ganda tidak
 * membuat run ganda (PRD §10).
 */
export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return problem(503, "GITHUB_WEBHOOK_SECRET belum diset");

  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig.replace("sha256=", ""), "hex");
  const b = Buffer.from(expected.replace("sha256=", ""), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return problem(401, "Signature webhook tidak valid");

  const delivery = req.headers.get("x-github-delivery") ?? "";
  if (delivery && (await one<{ key: string }>("SELECT key FROM kv WHERE key = ?", [`gh:${delivery}`]))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (delivery) dbRun("INSERT OR IGNORE INTO kv(key, value, updated_at) VALUES(?,?,?)", [`gh:${delivery}`, "1", nowIso()]);

  const event = req.headers.get("x-github-event") ?? "push";
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return problem(400, "Payload JSON tidak valid");
  }

  const repoUrl = payload.repository?.clone_url;
  if (!repoUrl) return problem(422, "Payload tidak memuat repository.clone_url");
  const project = await one<{ id: string }>("SELECT id FROM projects WHERE repo_url = ?", [repoUrl]);
  if (!project) return problem(404, "Project untuk repository ini belum terhubung");

  const branch = (payload.ref ?? "").replace("refs/heads/", "");
  if (event === "pull_request") {
    // pull_request event: use base branch
    const prBranch = payload.pull_request?.base?.ref ?? branch;
    const env = await one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", [project.id]);
    if (!env) return problem(422, "Project belum punya environment");

    const { runId, duplicate } = await createRun({
      projectId: project.id,
      environmentId: env.id,
      trigger: "webhook",
      branch: prBranch,
      commitSha: payload.pull_request?.head?.sha ?? payload.after,
      idempotencyKey: `${repoUrl}:${payload.pull_request?.head?.sha ?? payload.after}:pull_request`,
    });
    if (!duplicate) advanceRun(runId).catch(() => {});
    return NextResponse.json({ ok: true, run_id: runId, duplicate }, { status: duplicate ? 200 : 202 });
  }

  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  const env = await one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", [project.id]);
  if (!env) return problem(422, "Project belum punya environment");

  const { runId, duplicate } = await createRun({
    projectId: project.id,
    environmentId: env.id,
    trigger: "webhook",
    branch,
    commitSha: payload.after,
    // idempotency: repo+commit+trigger (PRD §10)
    idempotencyKey: `${repoUrl}:${payload.after}:push`,
  });
  if (!duplicate) advanceRun(runId).catch(() => {});

  return NextResponse.json({ ok: true, run_id: runId, duplicate }, { status: duplicate ? 200 : 202 });
}

/** GET — daftar webhook aktif (informasi konfigurasi, tanpa secret). */
export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    events: ["push", "pull_request"],
    note: "Verifikasi HMAC SHA-256 header x-hub-signature-256; dedupe via x-github-delivery",
    projects: await all("SELECT id, name, repo_url FROM projects"),
  });
}