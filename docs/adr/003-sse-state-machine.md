# ADR 003: SSE-Driven State Machine (No Temporal)

**Date**: 2026-10-06
**Status**: Accepted

## Context

Pipeline has 14 steps, each with timeout/retry policy. Spec calls for Temporal workflows for durability.

Vercel constraints:
- No long-running processes
- Function timeout 10s (Hobby) / 60s (Pro)
- No background workers

## Decision

**Replace Temporal with SQLite-backed state machine driven by SSE heartbeats.**

### Architecture

```
┌─────────────┐     SSE (1s)     ┌──────────────────┐
│  Browser    │ ──────────────►  │ /api/v1/runs/    │
│  (client)   │ ◄──────────────  │ [id]/stream      │
└─────────────┘   progress JSON  └────────┬─────────┘
                                          │
                                          ▼
                                 ┌──────────────────┐
                                 │ advanceRun(id)   │
                                 │  - load run      │
                                 │  - if step done  │
                                 │    → next step   │
                                 │  - persist       │
                                 └──────────────────┘
```

### `advanceRun()` (in `engine.ts`)

```typescript
export async function advanceRun(runId: string) {
  const run = one("SELECT * FROM runs WHERE id=?", [runId]);
  if (!run || isTerminal(run.status)) return;
  const step = currentStep(run);
  if (step.status === "running" && step.startedAt < now - timeout) {
    markFailed(step, "timeout");
  }
  if (step.status === "pending" && depsMet(run, step)) {
    await executeStep(run, step);
  }
  // persist status, maybe queue next
}
```

### Step Definitions (`types.ts`)

```typescript
export const STEP_META = {
  CLONING: { timeoutMs: 120_000, retries: 1 },
  ANALYZING: { timeoutMs: 180_000, retries: 1 },
  // ...
};
```

## Consequences

| Positive | Negative |
|----------|----------|
| Works on Vercel Hobby (no worker) | Client must stay connected (SSE) |
| Durable — state in SQLite | No server-side retry if client disconnects |
| Simple to debug (SQL queries) | Long runs need real runner offload |
| No external dependency | Manual compensation for failures |

## Client Reconnection

`LiveRun` component (`live-run.tsx`):
- `EventSource` with exponential backoff (1s → 2s → 4s → max 30s)
- On reconnect, server streams current state immediately
- `advanceRun` called on each SSE tick (server-side)

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| Polling (REST) | ❌ More requests, same problem |
| WebSockets | ❌ Vercel doesn't support persistent WS |
| Inngest / Trigger.dev | ❌ External SaaS, not "no credentials" |
| Cron + `pg_cron` | ❌ No Postgres on Vercel Hobby |

## Migration Path (V1)

When moving to Postgres + self-hosted:
1. Replace SSE loop with background worker (BullMQ / pg_boss)
2. Keep `advanceRun` logic — just change trigger
3. Add dead-letter queue for failed steps