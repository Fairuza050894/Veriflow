# ADR 004: Real Runner Pull-Poll Contract

**Date**: 2026-10-06
**Status**: Accepted

## Context

MVP uses mock execution (`simulateShardExecution` — instant, deterministic).
Need **real Playwright execution** on actual infrastructure without:
- Long-running workers on Vercel
- Persistent queue infrastructure
- WebSocket connections

## Decision

**Pull-poll + push contract** between Vercel API and external runner.

### Flow

```
1. Engine reaches EXECUTING step
   │
   ├─► Creates shards → kv(shards:run_id) = [{index, total, testIds, ...}]
   │
2. Runner (GH Actions / Docker) polls:
   GET /api/v1/internals/results?run_id=run_xxx
   │
   ├─► API returns next unassigned shard (or null)
   │
3. Runner executes shard:
   - git clone repo at commit
   - npm ci
   - npx playwright test --shard=N/M --grep @veriflow-id:...
   │
4. Runner pushes results:
   POST /api/v1/internals/results
   Body: { runId, shardIndex, status, results[], durationMs }
   Header: X-Veriflow-Signature: HMAC-SHA256(payload, RUNNER_CALLBACK_SECRET)
   │
5. API verifies HMAC, stores test_results, advances run
```

### Why Pull (Not Push from API)?

| Push (Webhook) | Pull (Poll) |
|----------------|-------------|
| Runner must be reachable (public IP) | Runner initiates — works behind NAT/firewall |
| Vercel must track runner endpoints | Stateless — runner scales horizontally |
| Retry logic on Vercel side | Runner controls backoff |
| **Fails if runner down** | **Resilient — runner polls when ready** |

### Shard Assignment

- **Deterministic**: `testIds` assigned round-robin by hash at `PROVISIONING` step
- **Idempotent**: Shard index + runId = unique key; re-poll returns same shard
- **Timeout**: `RUNNER_MAX_SHARD_MS` (default 5 min) — runner kills Playwright

### Security

- `RUNNER_CALLBACK_SECRET` in Vercel env + runner env (never in DB)
- HMAC-SHA256 on **exact JSON payload** (no canonicalization)
- Replay prevented: `(runId, shardIndex)` unique constraint in `test_results`

## Consequences

| Positive | Negative |
|----------|----------|
| Runner runs anywhere (GH Actions, VPS, laptop) | Extra latency (poll interval) |
| No infra on Vercel side | Runner must be online for run to complete |
| Horizontal scaling = more runners | Shard timeout must exceed Playwright max |
| Works with private repos (GH token) | Clone + install per shard (cacheable) |

## Runner Implementation

- `runner/worker.mjs` — Node 26, zero deps, ES modules
- `runner/Dockerfile` — Alpine + Chromium + Playwright deps
- `.github/workflows/autoqa.yml` — `workflow_dispatch` + optional `run_id`

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| Vercel Edge Functions + WebSocket | ❌ No WS on Vercel |
| GitHub Actions `jobs.<id>.steps` direct | ❌ Can't stream results back to Vercel mid-run |
| Inngest / Trigger.dev | ❌ External dependency |
| Temporal on Fly.io | ❌ Defeats "Vercel deploy" requirement |

## Future: Push from API (V1)

When self-hosted runner pool:
- API pushes to runner gRPC / HTTP endpoint
- Runner registers on startup
- Better for low-latency, high-throughput