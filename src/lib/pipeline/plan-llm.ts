import { loadPrompt, render } from "@/lib/prompts";
import { getAdapter, callLLM, type LLMMetrics } from "../llm";
import { TestPlanSchema, type TestPlan, type Analysis } from "../contracts";
import type { Workspace } from "../workspace";

export interface PlanResult {
  plan: TestPlan;
  metrics: LLMMetrics;
}

const FALLBACK_MAX = Number(process.env.VERIFLOW_MAX_TESTS ?? 60);

/**
 * LLM-powered test planner. Falls back to deterministic planner on error.
 * Uses prompt v4-planner when available.
 */
export async function planTestsWithLLM(analysis: Analysis, opts: { max?: number } = {}): Promise<PlanResult> {
  const adapter = getAdapter();
  if (adapter.provider === "mock") {
    const { planTestsDeterministic } = await import("./plan");
    return { plan: planTestsDeterministic(analysis, opts), metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 } };
  }

  try {
    const prompt = await loadPrompt("v4-planner");
    if (!prompt) throw new Error("Prompt v4-planner not found");

    const user = render(prompt.body, {
      stack: analysis.stack.frameworks.join(", "),
      endpoints: analysis.api.endpoints.map((e) => `${e.method} ${e.path}`).join(", "),
      routes: analysis.app.routes.map((r) => r.path).join(", "),
      max: opts.max ?? FALLBACK_MAX,
    });

    const { content, metrics } = await callLLM(adapter, prompt.body.split("\n")[0] ?? "Plan tests for this repository.", user, {
      temperature: 0.1,
      maxTokens: 8192,
    });

    const parsed = JSON.parse(content);
    return { plan: TestPlanSchema.parse(parsed), metrics };
  } catch (e) {
    // Fallback to deterministic on any LLM error
    const { planTestsDeterministic } = await import("./plan");
    return { plan: planTestsDeterministic(analysis, opts), metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 } };
  }
}