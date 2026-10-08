import type { Analysis, TestPlan } from "../contracts";
import type { Workspace } from "../workspace";
import type { GeneratedTest } from "../pipeline/generate";
import type { TestStatus } from "../types";

export type LLMProvider = "mock" | "openai" | "anthropic";

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMAdapter {
  readonly provider: LLMProvider;
  readonly model: string;
  complete(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, opts?: LLMOptions): Promise<string>;
}

export interface LLMMetrics {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  provider?: LLMProvider;
  model?: string;
}

export async function callLLM(
  adapter: LLMAdapter,
  system: string,
  user: string,
  opts?: LLMOptions,
): Promise<{ content: string; metrics: LLMMetrics }> {
  const start = Date.now();
  const content = await adapter.complete(
    [{ role: "system", content: system }, { role: "user", content: user }],
    opts,
  );
  const latencyMs = Date.now() - start;
  // Rough token estimation (4 chars ≈ 1 token)
  const inputTokens = Math.ceil((system.length + user.length) / 4);
  const outputTokens = Math.ceil(content.length / 4);
  const costUsd = estimateCost(adapter.provider, adapter.model, inputTokens, outputTokens);
  return { content, metrics: { inputTokens, outputTokens, costUsd, latencyMs, provider: adapter.provider, model: adapter.model } };
}

function estimateCost(provider: LLMProvider, model: string, inTok: number, outTok: number): number {
  const rates: Record<string, { in: number; out: number }> = {
    // Per 1M tokens (approx, update from provider pricing pages)
    "openai:gpt-4o": { in: 5.00, out: 15.00 },
    "openai:gpt-4o-mini": { in: 0.15, out: 0.60 },
    "openai:gpt-4.1": { in: 2.50, out: 10.00 },
    "anthropic:claude-3-5-sonnet-20241022": { in: 3.00, out: 15.00 },
    "anthropic:claude-3-5-haiku-20241022": { in: 0.25, out: 1.25 },
    "mock": { in: 0, out: 0 },
  };
  const key = `${provider}:${model}`;
  const rate = rates[key] ?? { in: 0, out: 0 };
  return (inTok * rate.in + outTok * rate.out) / 1_000_000;
}

export function getAdapter(): LLMAdapter {
  const provider = (process.env.LLM_PROVIDER as LLMProvider) ?? "mock";
  const model = process.env.LLM_MODEL ?? (provider === "openai" ? "gpt-4o-mini" : provider === "anthropic" ? "claude-3-5-haiku-20241022" : "mock");

  if (provider === "openai") {
    return new OpenAIAdapter(model);
  }
  if (provider === "anthropic") {
    return new AnthropicAdapter(model);
  }
  return new MockAdapter();
}

class MockAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "mock";
  readonly model = "mock-llm";
  async complete(_messages: Array<{ role: string; content: string }>): Promise<string> {
    return JSON.stringify({ ok: true, mock: true });
  }
}

class OpenAIAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL = "https://api.openai.com/v1";

  constructor(model: string) {
    this.model = model;
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");
  }

  async complete(messages: Array<{ role: string; content: string }>, opts?: LLMOptions): Promise<string> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts?.temperature ?? 0.1,
        max_tokens: opts?.maxTokens ?? 4096,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.choices[0]?.message?.content ?? "";
  }
}

class AnthropicAdapter implements LLMAdapter {
  readonly provider: LLMProvider = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL = "https://api.anthropic.com/v1";

  constructor(model: string) {
    this.model = model;
    this.apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  }

  async complete(messages: Array<{ role: string; content: string }>, opts?: LLMOptions): Promise<string> {
    // Convert to Anthropic format: system prompt separate
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const userMessages = messages.filter((m) => m.role !== "system");
    const res = await fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        system,
        messages: userMessages,
        temperature: opts?.temperature ?? 0.1,
        max_tokens: opts?.maxTokens ?? 4096,
      }),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }
}