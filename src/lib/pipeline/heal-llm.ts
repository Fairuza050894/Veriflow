import { loadPrompt, render } from "@/lib/prompts";
import { getAdapter, callLLM, type LLMMetrics } from "../llm";
import type { GeneratedTest } from "./generate";

export interface HealResult {
  tests: GeneratedTest[];
  metrics: LLMMetrics;
}

/**
 * LLM-powered self-healing for failed/flaky tests.
 * Uses prompt v3-healer when available. Runs max 3 iterations.
 */
export async function healTestsWithLLM(
  tests: GeneratedTest[],
  failed: Array<{ testId: string; error: string; category?: string; gate?: string }>,
  maxIterations = 3,
): Promise<HealResult> {
  const adapter = getAdapter();
  if (adapter.provider === "mock") {
    const { healTest } = await import("./quality");
    const healed = tests.map((t) => {
      const f = failed.find((x) => x.testId === t.conceptId);
      return f ? healTest(t, f.error) : t;
    });
    return { tests: healed, metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 } };
  }

  const prompt = await loadPrompt("v3-healer");
  if (!prompt) throw new Error("Prompt v3-healer not found");

  let current = [...tests];
  let totalMetrics: LLMMetrics = { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };

  for (let iter = 0; iter < maxIterations; iter++) {
    const stillFailing = failed.filter((f) => current.some((t) => t.conceptId === f.testId));
    if (!stillFailing.length) break;

    const batch = stillFailing.slice(0, 5); // heal up to 5 per iteration
    const { content, metrics } = await callLLM(
      adapter,
      "You are a Playwright test expert. Fix failing tests by adjusting selectors, assertions, or adding waits. Output JSON array of fixed test objects only.",
      render(prompt.body, {
        failing: JSON.stringify(batch.map((f) => ({
          test: current.find((t) => t.conceptId === f.testId),
          error: f.error,
          category: f.category ?? f.gate,
        })), null, 2),
        iteration: iter + 1,
      }),
      { temperature: 0.1, maxTokens: 8192 },
    );

    totalMetrics.inputTokens += metrics.inputTokens;
    totalMetrics.outputTokens += metrics.outputTokens;
    totalMetrics.costUsd += metrics.costUsd;
    totalMetrics.latencyMs += metrics.latencyMs;

    try {
      const fixed = JSON.parse(content);
      for (const f of fixed) {
        const idx = current.findIndex((t) => t.conceptId === f.conceptId);
        if (idx >= 0) current[idx] = { ...current[idx], ...f, code: f.code ?? current[idx].code };
      }
    } catch {
      // If parsing fails, keep current and continue
    }
  }

  return { tests: current, metrics: totalMetrics };
}