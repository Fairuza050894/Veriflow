# ADR 006: Full i18n (ID/EN) + Mock Adapters with Env Upgrade Path

**Date**: 2026-10-06
**Status**: Accepted

## Context

Spec requires:
- Two languages: Indonesian (primary) + English
- No credentials in repo — all adapters have interfaces + deterministic mocks
- Env var upgrade path for real providers (LLM, Git, Email, Runner)

## Decision

### i18n: Server-Side Dict + Cookie

**No `next-intl` / `i18next`** — too heavy for simple two-language app.

```typescript
// lib/i18n.ts
export const dict = {
  id: { "brand.name": "Veriflow", "action.run": "Jalankan", ... },
  en: { "brand.name": "Veriflow", "action.run": "Run", ... },
} as const;

export function t(lang: "id" | "en", key: string): string {
  return dict[lang][key] ?? dict.en[key] ?? key;
}

// lib/lang-server.ts (Server Component)
export async function getLang(): Promise<"id" | "en"> {
  const cookie = (await cookies()).get("vf_lang")?.value;
  if (cookie === "id" || cookie === "en") return cookie;
  // fallback: Accept-Language header
  const h = headers().get("accept-language") ?? "";
  return h.startsWith("en") ? "en" : "id";
}
```

**Client toggle** (`lang-toggle.tsx`):
- Sets cookie `vf_lang=id|en; Path=/; Max-Age=31536000`
- Triggers `router.refresh()` for server re-render

**Coverage**: All UI strings, email templates, diagram labels, prompt registry.

### Mock Adapters Pattern

Every external dependency has **interface + mock implementation**:

| Adapter | Interface | Mock | Real (Env) |
|---------|-----------|------|------------|
| LLM | `callLLM(prompt, model)` | `mockLLM` (deterministic seeded) | `OPENAI_API_KEY` → OpenAI SDK |
| Git | `clone(url, ref, dir)` | `fixtureRepo` (23 files) | `GITHUB_TOKEN` → `simple-git` |
| Email | `send(to, subject, html)` | `console.log` + DB outbox | `RESEND_API_KEY` → Resend SDK |
| Runner | `executeShard(shard)` | `simulateShardExecution` | `RUNNER_CALLBACK_SECRET` → HTTP |

**Example** (`prompts.ts`):
```typescript
export async function callLLM(prompt: string, model: string): Promise<string> {
  if (process.env.OPENAI_API_KEY) {
    // real implementation
  }
  // deterministic mock
  return mockLLMResponse(prompt);
}
```

**Deterministic mock**: Seeded RNG (`rng(seed)`) → same prompt = same output.

### Env Upgrade Path

All real implementations gated by env var presence:

```bash
# .env.example
OPENAI_API_KEY=           # unset → mock LLM
GITHUB_TOKEN=             # unset → fixture repo
RESEND_API_KEY=           # unset → mock email (console + DB)
RUNNER_CALLBACK_SECRET=   # unset → mock runner (instant)
```

**No code changes** to switch mock → real. Just add secret in Vercel / runner env.

## Consequences

| Positive | Negative |
|----------|----------|
| Zero secrets in repo | Mock behavior ≠ real (intentional) |
| Works offline / CI without keys | Must maintain mock parity |
| Deterministic tests | Seeded RNG must be stable across Node versions |
| Clear upgrade path | Real adapters add bundle size (tree-shaken if unused) |

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| `next-intl` | ❌ Overkill for 2 langs |
| Feature flags for mock/real | ❌ Env var is simpler flag |
| Separate mock/prod builds | ❌ Single build deploys everywhere |

## Migration Checklist (Mock → Real)

| Adapter | Env Var | Code Location | Test Command |
|---------|---------|---------------|--------------|
| LLM | `OPENAI_API_KEY` | `src/lib/prompts.ts` | `npm run test:llm` |
| Git | `GITHUB_TOKEN` | `src/lib/pipeline/workspace.ts` | `npm run test:git` |
| Email | `RESEND_API_KEY` | `src/lib/mailer.ts` | `npm run test:email` |
| Runner | `RUNNER_CALLBACK_SECRET` | `runner/worker.mjs` | `gh workflow run autoqa.yml` |