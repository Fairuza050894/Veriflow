import type { ExecResult, Shard } from "./execute";
import type { ErrorCategory, RunSummary } from "../types";
import { rng } from "../util";
import type { GeneratedTest } from "./generate";

/** BP-12 — klasifikasi kegagalan + metrik + tren. */
export function analyzeResults(
  results: ExecResult[],
  tests: GeneratedTest[],
  shards: Shard[],
  prevPassRate: number | null,
): RunSummary {
  const byId = new Map(tests.map((t) => [t.conceptId, t]));
  const categories: Record<string, number> = {};
  const topFailures: RunSummary["top_failures"] = [];
  const severity = { product_bug: 3, test_bug: 2, data_issue: 2, env_issue: 1, infra: 1, flaky: 0 } as Record<ErrorCategory, number>;

  for (const r of results) {
    if (!r.errorCategory) continue;
    categories[r.errorCategory] = (categories[r.errorCategory] ?? 0) + 1;
    const t = byId.get(r.testId);
    if (r.status === "failed") {
      topFailures.push({
        title: t?.title ?? r.testId,
        file: t?.file ?? "",
        category: r.errorCategory,
        message: r.errorMessage ?? "",
      });
    }
  }
  topFailures.sort((a, b) => severity[b.category as ErrorCategory] - severity[a.category as ErrorCategory]);

  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const flaky = results.filter((r) => r.status === "flaky").length;
  const skipped = results.filter((r) => r.status === "skipped" || r.status === "timedout").length;
  const duration = shards.reduce((a, s) => a + s.estimatedMs, 0);
  const passRate = total ? (passed + flaky * 0.5) / total : 0;

  return {
    total,
    passed,
    failed,
    flaky,
    skipped,
    duration_ms: Math.round(duration * 1.15),
    pass_rate: Number(passRate.toFixed(4)),
    delta_pass_rate: prevPassRate === null ? null : Number((passRate - prevPassRate).toFixed(4)),
    categories,
    top_failures: topFailures.slice(0, 5),
  };
}

/** BP-15 / §11 — skor flaky berbasis 20 run terakhir (disimulasikan dari histori DB). */
export function updateFlakyScore(hist: string[], seed: string): { score: number; state: "ok" | "suspect" | "quarantine" } {
  const r = rng(seed);
  const noise = r() < 0.08 ? 1 : 0;
  const flips = hist.filter((h, i) => i > 0 && h !== hist[i - 1]).length + noise;
  const score = Math.min(1, flips / 20);
  return {
    score: Number(score.toFixed(3)),
    state: score >= 0.3 ? "quarantine" : score >= 0.15 ? "suspect" : "ok",
  };
}