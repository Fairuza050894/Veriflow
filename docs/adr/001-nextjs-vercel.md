# ADR 001: Next.js 15 Monorepo-Lite on Vercel Hobby

**Date**: 2026-10-06
**Status**: Accepted

## Context

The PRD specifies a monorepo with `apps/*` + `packages/*` (Next.js dashboard, Temporal worker, API, runner). However, Vercel Hobby constraints:
- No persistent filesystem (SQLite must use `/tmp`)
- No long-running workers (max 10s function timeout)
- No background processes
- No custom Docker (only Next.js output)

Temporal, Postgres, Redis, S3, Vault cannot run on Vercel.

## Decision

**Single Next.js 15 application** (`src/app/`, `src/lib/`) deployed to Vercel.
- All pipeline logic runs in-process via **SSE-driven state machine** (`advanceRun` called from `/api/v1/runs/[id]/stream`)
- SQLite (`node:sqlite` `DatabaseSync`) for local dev + Vercel `/tmp` ephemeral storage
- Real runner as **separate pull-poll worker** (GitHub Actions `workflow_dispatch` or Docker on VPS)
- No Temporal — replaced by durable SQLite state machine

## Consequences

| Positive | Negative |
|----------|----------|
| Deploys free on Vercel Hobby | No horizontal scaling (single instance) |
| Zero infra management | DB resets on each Vercel deploy |
| Simple mental model | Long runs must offload to runner |
| Fast iteration | No built-in retry/dead-letter (manual) |

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| Temporal Cloud + Vercel | ❌ Cost + complexity |
| Railway / Render / Fly.io | ❌ Not "Vercel deploy" requirement |
| Next.js + Edge Functions | ❌ SQLite not on Edge |
| Prisma + Postgres (Neon) | ✅ V1 migration target |

## Migration Path (V1)

1. Add Prisma schema (mirrors `schema.sql`)
2. Provision Neon / Vercel Postgres
3. Swap `db.ts` → Prisma Client + driver adapter
4. Deploy to Vercel with `DATABASE_URL`
5. Enable multi-instance (remove SQLite singleton)