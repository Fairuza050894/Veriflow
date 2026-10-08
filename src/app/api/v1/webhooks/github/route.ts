import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { all, one, run as dbRun, nowIso, uid } from "@/lib/db";
import { createRun, advanceRun } from "@/lib/pipeline/engine";
import { problem } from "@/lib/http";
import { verifyGitHubAppWebhook, getConfig } from "@/lib/github-app";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/github — terima event push / pull_request.
 * Dukung dua mode autentikasi:
 * 1. GitHub App (direkomendasikan): verifikasi via GITHUB_APP_WEBHOOK_SECRET + installation token
 * 2. Legacy PAT/Webhook: verifikasi HMAC SHA-256 via GITHUB_WEBHOOK_SECRET
 * Keamanan: verifikasi HMAC + dedupe delivery-id (Arsitektur §12).
 * Bentukkan idempotency key `repo+commit+trigger` supaya webhook ganda tidak
 * membuat run ganda (PRD §10).
 */
export async function POST(req: Request) {
  const appConfig = getConfig();
  
  let payload: any;
  let installationId: string | null = null;
  let raw: string;
  let delivery: string;

  // Try GitHub App verification first
  if (appConfig) {
    const result = await verifyGitHubAppWebhook(req, appConfig);
    if (result) {
      payload = result.payload;
      installationId = result.installationId;
      raw = await req.clone().text(); // re-read for delivery header
      delivery = req.headers.get("x-github-delivery") ?? "";
    } else {
      return problem(401, "GitHub App webhook signature tidak valid");
    }
  } else {
    // Legacy PAT/Webhook verification
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return problem(503, "GITHUB_WEBHOOK_SECRET atau GITHUB_APP_WEBHOOK_SECRET belum diset");

    raw = await req.text();
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(sig.replace("sha256=", ""), "hex");
    const b = Buffer.from(expected.replace("sha256=", ""), "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return problem(401, "Signature webhook tidak valid");

    try {
      payload = JSON.parse(raw);
    } catch {
      return problem(400, "Payload JSON tidak valid");
    }
    delivery = req.headers.get("x-github-delivery") ?? "";
  }

  // Dedupe delivery ID
  if (delivery && (await one<{ key: string }>("SELECT key FROM kv WHERE key = ?", [`gh:${delivery}`]))) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const event = req.headers.get("x-github-event") ?? "push";

  // Parse payload if not already parsed (GitHub App path)
  if (!payload) {
    try {
      payload = JSON.parse(raw);
    } catch {
      return problem(400, "Payload JSON tidak valid");
    }
  }

  // Get repo URL - prefer installation token clone URL for private repos
  let repoUrl = payload?.repository?.clone_url;
  if (installationId && appConfig) {
    const { getRepoCloneUrl } = await import("@/lib/github-app");
    const owner = payload?.repository?.owner?.login;
    const repo = payload?.repository?.name;
    if (owner && repo) {
      try {
        repoUrl = await getRepoCloneUrl(appConfig, installationId, owner, repo);
      } catch {
        // Fall back to public clone_url
      }
    }
  }

  if (!repoUrl) return problem(422, "Payload tidak memuat repository.clone_url");
  
  const project = await one<{ id: string }>("SELECT id FROM projects WHERE repo_url = ?", [repoUrl]);
  if (!project) return problem(404, "Project untuk repository ini belum terhubung");

  const branch = (payload.ref ?? "").replace("refs/heads/", "");
  
  if (event === "pull_request") {
    // pull_request event: use base branch
    const prBranch = payload.pull_request?.base?.ref ?? branch;
    const env = await one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? ORDER BY id DESC LIMIT 1", [project.id]);
    if (!env) return problem(422, "Project belum punya environment");

    const { runId, duplicate } = await createRun({
      projectId: project.id,
      environmentId: env.id,
      trigger: "webhook",
      branch: prBranch,
      commitSha: payload.pull_request?.head?.sha ?? payload.after,
      idempotencyKey: `${repoUrl}:${payload.pull_request?.head?.sha ?? payload.after}:pull_request`,
    });
    if (delivery) await dbRun("INSERT INTO kv(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING", [`gh:${delivery}`, runId, nowIso()]);
    if (!duplicate) advanceRun(runId).catch(() => {});
    return NextResponse.json({ ok: true, run_id: runId, duplicate }, { status: duplicate ? 200 : 202 });
  }

  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  const env = await one<{ id: string }>("SELECT id FROM environments WHERE project_id = ? ORDER BY id DESC LIMIT 1", [project.id]);
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
  if (delivery) await dbRun("INSERT INTO kv(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING", [`gh:${delivery}`, runId, nowIso()]);
  if (!duplicate) advanceRun(runId).catch(() => {});

  return NextResponse.json({ ok: true, run_id: runId, duplicate }, { status: duplicate ? 200 : 202 });
}

/** GET — daftar webhook aktif (informasi konfigurasi, tanpa secret). */
export async function GET() {
  const appConfig = getConfig();
  return NextResponse.json({
    configured: Boolean(process.env.GITHUB_WEBHOOK_SECRET) || Boolean(appConfig),
    mode: appConfig ? "github_app" : "legacy_pat",
    events: ["push", "pull_request"],
    note: appConfig 
      ? "GitHub App mode: verifikasi HMAC SHA-256 via GITHUB_APP_WEBHOOK_SECRET; installation token untuk clone private repo"
      : "Legacy mode: verifikasi HMAC SHA-256 header x-hub-signature-256 via GITHUB_WEBHOOK_SECRET; dedupe via x-github-delivery",
    projects: await all("SELECT id, name, repo_url FROM projects"),
  });
}