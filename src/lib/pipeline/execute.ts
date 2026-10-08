import type { GeneratedTest } from "./generate";
import type { ErrorCategory, TestStatus } from "../types";
import { clamp, rng, sleep } from "../util";

export type Shard = { index: number; total: number; testIds: string[]; estimatedMs: number };
export type ExecResult = {
  testId: string; status: TestStatus; durationMs: number; retries: number;
  errorMessage: string | null; errorCategory: ErrorCategory | null;
};

/**
 * BP-11 §5.4 — Sharding cerdas: bin-packing berdasarkan durasi historis, bukan jumlah file.
 * Test @serial/berbagi state -> shard sendiri workers=1.
 */
export function planShards(
  tests: GeneratedTest[],
  hist: Map<string, number>,
  opts: { maxParallel?: number; targetMs?: number } = {},
): Shard[] {
  const maxParallel = clamp(opts.maxParallel ?? Number(process.env.RUNNER_MAX_PARALLEL ?? 4), 1, 32);
  const targetMs = opts.targetMs ?? 60_000;
  const items = tests
    .map((t) => ({ id: t.conceptId, ms: hist.get(t.conceptId) ?? avgMs(t.layer) }))
    .sort((a, b) => b.ms - a.ms);
  const totalMs = items.reduce((a, b) => a + b.ms, 0);
  const total = clamp(Math.ceil(totalMs / targetMs), 1, maxParallel);

  const bins: Array<{ ms: number; ids: string[] }> = Array.from({ length: total }, () => ({ ms: 0, ids: [] }));
  for (const it of items) {
    const bin = bins.reduce((best, b) => (b.ms < best.ms ? b : best), bins[0]);
    bin.ids.push(it.id);
    bin.ms += it.ms;
  }
  return bins.map((b, i) => ({
    index: i + 1,
    total,
    testIds: b.ids,
    estimatedMs: Math.round(b.ms),
  }));
}

const avgMs = (layer: string) => (layer === "api" ? 900 : layer === "ui" ? 4200 : 11_000);

/**
 * Executor. `RUNNER_PROVIDER=none` -> simulasi deterministik (demo offline).
 * `RUNNER_PROVIDER=http` -> job spec dikirim ke runner Playwright sungguhan
 * (runner/worker.mjs), hasilnya dikirim balik ke /api/v1/internals/results.
 */
export async function executeShard(
  shard: Shard,
  tests: GeneratedTest[],
  seed: string,
  opts: { onProgress?: (done: number, total: number) => void | Promise<unknown>; delayMs?: number } = {},
): Promise<ExecResult[]> {
  const byId = new Map(tests.map((t) => [t.conceptId, t]));
  const delay = opts.delayMs ?? Number(process.env.VERIFLOW_STEP_DELAY_MS ?? 120);
  const out: ExecResult[] = [];

  for (const [i, id] of shard.testIds.entries()) {
    const t = byId.get(id);
    if (!t) continue;
    const r = rng(`${seed}:${id}`);
    // Prioritas node kritikal lebih Likely gagal → cerita dashboard terasa nyata
    const pFail = t.priority === "P0" ? 0.14 : 0.07;
    const pFlaky = 0.05;
    const roll = r();
    let status: TestStatus = "passed";
    let retries = 0;
    let errorMessage: string | null = null;
    let category: ErrorCategory | null = null;

    if (roll < pFail) {
      status = "failed";
      retries = 2;
      const pick = r();
      if (t.layer === "api") {
        category = pick < 0.6 ? "product_bug" : pick < 0.8 ? "test_bug" : "env_issue";
        errorMessage = category === "product_bug"
          ? "expected 201, received 422 — skema body tidak sesuai kontrak"
          : category === "test_bug"
            ? "body tidak ter-parse: respons HTML 502 dari gateway"
            : "ETIMEDOUT saat menghubungi API_BASE_URL";
      } else {
        category = pick < 0.5 ? "test_bug" : pick < 0.75 ? "product_bug" : "infra";
        errorMessage = category === "test_bug"
          ? "locator getByTestId('shipments-table') tidak ditemukan (0 element)"
          : category === "product_bug"
            ? "error 500 saat render halaman /shipments"
            : "browser context crashed (OOM)";
      }
    } else if (roll < pFail + pFlaky) {
      status = "flaky";
      retries = 1;
      category = "flaky";
      errorMessage = "lulus pada retry 2 — race condition pada network load";
    }

    const base = avgMs(t.layer);
    out.push({
      testId: id,
      status,
      durationMs: Math.round(base * (0.6 + r() * 0.9)),
      retries,
      errorMessage,
      errorCategory: category,
    });
    if (delay) await sleep(delay);
    await opts.onProgress?.(i + 1, shard.testIds.length);
  }
  return out;
}

/** RUNNER_PROVIDER=http: kirim job spec ke runner eksternal (Playwright asli). */
export async function dispatchToRunner(job: unknown): Promise<{ accepted: boolean; detail: string }> {
  const url = process.env.RUNNER_URL;
  if (!url) return { accepted: false, detail: "RUNNER_URL belum diset" };
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.RUNNER_CALLBACK_SECRET ? { "x-veriflow-secret": process.env.RUNNER_CALLBACK_SECRET } : {}),
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(15_000),
    });
    return { accepted: res.ok, detail: await res.text() };
  } catch (e) {
    return { accepted: false, detail: (e as Error).message };
  }
}
