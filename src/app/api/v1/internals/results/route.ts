import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { all, one, run as dbRun, nowIso, kvGet, kvSet, J } from "@/lib/db";
import { advanceRun, log } from "@/lib/pipeline/engine";
import { problem, unprocessable } from "@/lib/http";
import type { ExecResult } from "@/lib/pipeline/execute";

export const dynamic = "force-dynamic";

/** Shared secret sederhana; bandingkan timing-safe. */
function authorized(req: Request): boolean {
  const expected = process.env.RUNNER_CALLBACK_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-veriflow-secret") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/v1/internals/results — runner Playwright sungguhan mengirim hasil shard.
 * Ini adalah titik masuk "runner nyata" yang diminta: tanpa Temporal/Kubernetes,
 * runner (GitHub Actions / Docker di VPS)只需 POST ke sini.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return problem(401, "Secret runner tidak valid");

  const body = (await req.json().catch(() => ({}))) as {
    run_id?: string; shard?: number; tests?: ExecResult[];
    usage?: { tokens_in?: number; tokens_out?: number; cost_usd?: number };
  };
  if (!body.run_id) return unprocessable("run_id wajib diisi");
  const run = await one<{ id: string }>("SELECT id FROM runs WHERE id = ?", [body.run_id]);
  if (!run) return problem(404, "Run tidak ditemukan");

  const tests = (body.tests ?? []).filter((t) => t && typeof t.testId === "string");
  if (!tests.length) return unprocessable("Tidak ada hasil test pada payload");

  // idemoten per shard: kalau shard sama sudah masuk, jangan dobelkan (FR-ORC-03)
  const shardNo = Number(body.shard ?? 1);
  const key = `exec:${body.run_id}:${shardNo}`;
  if (kvGet(key)) {
    return NextResponse.json({ ok: true, duplicate: true, shard: shardNo });
  }
  kvSet(key, JSON.stringify(tests));

  log(body.run_id, "EXECUTING", `runner eksternal mengirim hasil shard ${shardNo} (${tests.length} test)`, "info");

  // rangkai hasil seluruh shard
  const total = Number((await one<{ n: string }>("SELECT COUNT(*) n FROM kv WHERE key LIKE ?", [`exec:${body.run_id}:%`]))?.n ?? 1);
  const merged: ExecResult[] = (await all<{ key: string; value: string }>(
    "SELECT key, value FROM kv WHERE key LIKE ?", [`exec:${body.run_id}:%`],
  )).flatMap((r) => J.parse<ExecResult[]>(r.value, []));

  const expected = Number(
    (J.parse<Array<{ total: number }>>(kvGet(`shards:${body.run_id}`), [])[0]?.total ?? total),
  );
  if (total >= expected) {
    kvSet(`exec:${body.run_id}`, JSON.stringify(merged));
    log(body.run_id, "EXECUTING", `semua ${total} shard masuk, lanjut analisis hasil`);
    advanceRun(body.run_id).catch(() => {});
  }

  if (body.usage) {
    kvSet(`usage:${body.run_id}`, JSON.stringify(body.usage));
    dbRun("INSERT INTO kv(key, value, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [`runner_usage:${body.run_id}`, JSON.stringify(body.usage), nowIso()]);
  }

  return NextResponse.json({ ok: true, shard: shardNo, collected: total, expected });
}

/** GET — status job yang menunggu runner (dipakai runner untuk polling). */
export async function GET(req: Request) {
  if (!authorized(req)) return problem(401, "Secret runner tidak valid");
  const runId = new URL(req.url).searchParams.get("run_id");
  if (!runId) return unprocessable("run_id wajib diisi");
  const generated = J.parse<Array<{ conceptId: string; file: string; title: string; layer: string; tags: string[]; covers: string[]; priority: string; code: string }>>(
    kvGet(`generated:${runId}`), []);
  const shards = J.parse<Array<{ index: number; total: number; testIds: string[]; estimatedMs: number }>>(kvGet(`shards:${runId}`), []);
  const env = await one<{ base_url: string; api_base_url: string; name: string }>(
    `SELECT e.base_url, e.api_base_url, e.name FROM environments e JOIN runs r ON r.environment_id = e.id WHERE r.id = ?`, [runId]);
  if (!generated.length || !shards.length) return problem(409, "Run belum sampai tahap EXECUTING");

  return NextResponse.json({
    // Kontrak job runner (Arsitektur §5.2) — disederhanakan: tanpa S3, test dikirim inline.
    run_id: runId,
    shards,
    generated,
    environment: { name: env?.name ?? "default", base_url: env?.base_url ?? "", api_base_url: env?.api_base_url ?? "" },
    limits: { timeout_s: 1800 },
    // sandbox: runner wajib menolak egress di luar allowlist (docs/RUNNER.md)
    egress_allowlist: (env?.base_url ? [new URL(env.base_url).host] : []).concat(["registry.npmjs.org"]),
  });
}