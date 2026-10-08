import { loadPrompt, render } from "@/lib/prompts";
import { getAdapter, callLLM, type LLMMetrics } from "../llm";
import { TestPlanSchema, type TestPlan } from "../contracts";
import type { GeneratedTest } from "./generate";

/**
 * LLM-powered test generator. Falls back to template generator on error.
 * Uses prompt v2-generator when available.
 */
export async function generateTestsWithLLM(
  plan: TestPlan,
  root = "autoqa",
  opts: { promptVersion?: string } = {},
): Promise<{ tests: GeneratedTest[]; metrics: LLMMetrics }> {
  const adapter = getAdapter();
  if (adapter.provider === "mock") {
    const { generateTests } = await import("./generate");
    return { tests: generateTests(plan, root), metrics: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 } };
  }

  const promptName = opts.promptVersion ?? "v2-generator";
  const prompt = await loadPrompt(promptName);
  if (!prompt) throw new Error(`Prompt ${promptName} not found`);

  const results: GeneratedTest[] = [];
  let totalMetrics: LLMMetrics = { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };

  // Process in small batches to avoid token limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < plan.concepts.length; i += BATCH_SIZE) {
    const batch = plan.concepts.slice(i, i + BATCH_SIZE);
    const batchTests = await generateBatch(adapter, prompt, batch, root);
    results.push(...batchTests.tests);
    totalMetrics.inputTokens += batchTests.metrics.inputTokens;
    totalMetrics.outputTokens += batchTests.metrics.outputTokens;
    totalMetrics.costUsd += batchTests.metrics.costUsd;
    totalMetrics.latencyMs += batchTests.metrics.latencyMs;
  }

  return { tests: results, metrics: totalMetrics };
}

async function generateBatch(
  adapter: Awaited<ReturnType<typeof getAdapter>>,
  prompt: { body: string },
  concepts: TestPlan["concepts"],
  root: string,
): Promise<{ tests: GeneratedTest[]; metrics: LLMMetrics }> {
  const user = render(prompt.body, {
    concepts: JSON.stringify(concepts.map((c) => ({
      id: c.id,
      title: c.title,
      layer: c.layer,
      endpoint: c.endpoint,
      route: c.route,
      assertions: c.assertions,
      tags: c.tags,
      node: c.node,
    })), null, 2),
    root,
  });

  const system = "You are an expert Playwright test engineer. Generate TypeScript test files that are valid, self-contained, and follow best practices. Output JSON array of test objects only.";
  const { content, metrics } = await callLLM(adapter, system, user, { temperature: 0.2, maxTokens: 8192 });

  const parsed = JSON.parse(content);
  const tests: GeneratedTest[] = parsed.map((t: any, idx: number) => ({
    conceptId: concepts[idx]?.id ?? `gen-${idx}`,
    file: t.file ?? `${root}/tests/${concepts[idx]?.layer ?? "api"}/${concepts[idx]?.id}.spec.ts`,
    title: concepts[idx]?.title ?? `Generated test ${idx}`,
    layer: concepts[idx]?.layer ?? "api",
    tags: concepts[idx]?.tags ?? [],
    covers: concepts[idx]?.node ? [concepts[idx].node!] : [concepts[idx]?.endpoint, concepts[idx]?.route].filter(Boolean) as string[],
    priority: concepts[idx]?.priority ?? "P1",
    code: t.code ?? "",
  }));

  return { tests, metrics };
}