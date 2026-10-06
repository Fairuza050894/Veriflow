# Veriflow Architecture

> **Status**: Implemented (Next.js 15 on Vercel Hobby) — §5.2 runner, §7 API, §16 contracts, §18 diagrams per `02_TECHNICAL_ARCHITECTURE.md`

---

## System Context (D01)

```
┌─────────────┐     HTTPS      ┌─────────────┐
│  Customer   │ ─────────────► │   Vercel    │
│  (browser)  │ ◄───────────── │  (Next.js)  │
└─────────────┘   HTML/JSON    └──────┬──────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
             ┌─────────────┐   ┌─────────────┐  ┌─────────────┐
             │  SQLite     │   │  GitHub     │  │   Runner    │
             │  (in-proc)  │   │  (webhook)  │  │  (worker)   │
             └─────────────┘   └─────────────┘  └─────────────┘
                    ▲                 ▲                 │
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      ▼
                               ┌─────────────┐
                               │  Resend /   │
                               │  SMTP Mock  │
                               └─────────────┘
```

---

## Core Components

### 1. Next.js App (`src/app/`)
- **App Router** with `force-dynamic` for all data pages
- **Server Components** by default; Client Components only for interactivity (SSE, Mermaid, charts)
- **Middleware**: none (auth is project-scoped via signed report tokens)

### 2. Pipeline Engine (`src/lib/pipeline/engine.ts`)
**State machine** (14 steps):
```
CREATED → QUEUED → CLONING → ANALYZING → SCAFFOLDING → PLANNING
  → GENERATING → VALIDATING → HEALING → WAITING_APPROVAL
  → COMMITTING → PROVISIONING → EXECUTING → ANALYZING_RESULTS
  → REPORTING → NOTIFYING → COMPLETED | FAILED | CANCELLED
```

**Drivers**:
- **Mock** (default): `simulateShardExecution()` — instant, deterministic
- **Real** (opt-in): Runner pulls shards via `/api/v1/internals/results`, runs Playwright, pushes results

**Heartbeat**: SSE endpoint `/api/v1/runs/[id]/stream` calls `advanceRun()` each event loop tick

### 3. Architecture Extraction (`src/lib/arch/extract.ts`)
Six deterministic extractors (no LLM):
| Extractor | Input | Output Nodes | Output Edges |
|-----------|-------|--------------|--------------|
| Prisma | `prisma/schema.prisma` | `table`, `database` | `references`, `lives_in` |
| OpenAPI | `openapi.yaml`, `swagger.json` | `endpoint` | `calls`, `returns` |
| Routes | Next.js `app/**/route.ts`, `pages/api/**` | `endpoint`, `route` | `serves`, `exposes` |
| Compose | `docker-compose.yml` | `service`, `database` | `depends_on` |
| CI | `.github/workflows/*.yml` | `pipeline_stage` | `then` |
| Deps | `package.json` + `import` graph | `module` | `imports` |

**Findings** (auto-generated):
- `cycle` — circular module imports
- `missing_migration` — Prisma drift
- `ci_no_tests` / `ci_no_e2e` — pipeline gaps
- `unauthenticated_endpoint` — public API routes
- `orphan_module` — unused code

### 4. Diagram Composition (`src/lib/arch/compose.ts`)
**9 diagram kinds** (D01–D09, D10 stub):
| Kind | Title | Audience | In Email | Source |
|------|-------|----------|----------|--------|
| D01 | System context & container | customer | ✅ | `composeSystem` |
| D02 | Database ERD | internal | ❌ | `composeErd` |
| D03 | Module dependencies | internal | ❌ | `composeModules` |
| D04 | API map | internal | ❌ | `composeApiMap` |
| D05 | UI page map | internal | ❌ | `composeUiMap` |
| D06 | Sequence (HAR) | internal | ❌ | *stub* |
| D07 | CI/CD pipeline | customer | ✅ | `composePipeline` |
| D08 | Deploy topology | customer | ✅ | `composeInfra` |
| D09 | Test coverage overlay | customer | ✅ | `composeSystem` (overlay) |
| D10 | Architecture diff | internal | ❌ | *stub* |

**Redaction**: `audience="customer"` strips table/column names, internal-only nodes.

**Coverage overlay**: `node_coverage` → Mermaid `classDef` (pass/fail/flaky/gap/inferred).

**Truncation**: >150 nodes → top-N by centrality + failures + no-test score.

### 5. Database (`src/lib/db.ts` + `schema.sql`)
**20 tables**, zero native deps (`node:sqlite` `DatabaseSync`):
- `organizations`, `projects`, `environments`, `recipients`
- `runs`, `run_steps`, `run_logs`
- `test_results`, `test_stats`
- `arch_snapshots`, `arch_findings`, `devops_findings`, `diagrams`, `node_coverage`
- `email_messages`, `report_links`, `prompt_versions`, `kv`
- `ai_calls` (cost tracking)

**PRAGMA**: `busy_timeout = 10000`, `journal_mode = WAL`, `foreign_keys = ON`

### 6. Email / Notification (`src/lib/mailer.ts` + `report.ts`)
- **Outbox pattern**: `email_messages` table → `drainOutbox()` called at `NOTIFYING` step
- **Idempotency**: `run_id:kind:recipient` key prevents duplicates
- **Templates**: HTML (email-safe CSS) + plain-text fallback
- **Provider**: Resend (prod) / console log (dev) — swap via `EMAIL_PROVIDER`

### 7. i18n (`src/lib/i18n.ts` + `lang-server.ts`)
- **Locales**: `id` (default), `en`
- **Strategy**: Cookie `vf_lang` + `Accept-Language` header → server dict
- **Coverage**: All UI strings, email templates, diagram labels, prompt registry

---

## API Surface (`/api/v1/`)

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/projects` | GET/POST | — | List / create project |
| `/projects/quick-run` | POST | — | One-click demo run (mock clone) |
| `/projects/[id]` | GET/PATCH/DELETE | — | Project CRUD |
| `/projects/[id]/runs` | GET/POST | — | List / trigger run |
| `/runs/[id]` | GET | — | Run detail (summary, steps, tests, diagrams) |
| `/runs/[id]/stream` | GET (SSE) | — | Live progress + `advanceRun` heartbeat |
| `/runs/[id]/cancel` | POST | — | Set `CANCELLED` |
| `/runs/[id]/approve` | POST | — | Resume from `WAITING_APPROVAL` |
| `/runs/[id]/reject` | POST | — | Mark `REJECTED` |
| `/runs/[id]/tests` | GET | — | Test results with filters |
| `/runs/[id]/architecture` | GET | — | Arch snapshot + findings |
| `/runs/[id]/diagrams/[kind]` | GET | — | Mermaid source (client renders) |
| `/metrics/overview` | GET | — | Dashboard KPIs |
| `/webhooks/github` | POST | HMAC | GitHub push/PR → trigger run |
| `/internals/results` | GET/POST | HMAC | **Runner contract** (§5.2) |
| `/r/[token]` | GET | Signed | Public report (customer-safe) |

---

## Deferred / Ponytail Decisions

| Spec Feature | Status | Reason |
|--------------|--------|--------|
| Temporal workflows | ❌ Replaced | Vercel Hobby: no long-running workers. Replaced by SSE-driven `advanceRun` state machine |
| Postgres/Neon | ❌ Deferred | Vercel: no persistent FS. SQLite in `/tmp` (ephemeral) or `./.data` (dev) |
| Redis / BullMQ | ❌ Deferred | Same — no infra. In-process queue via `kv` table |
| S3 / Vault | ❌ Deferred | Not needed for MVP; artifacts in DB, secrets in Vercel env |
| D06 Sequence (HAR) | ⚠️ Stub | Requires real Playwright traces; runner infra not in MVP |
| D10 Arch Diff | ⚠️ Stub | `snapshotDiff()` exists; UI + rendering deferred |
| Real LLM adapters | ⚠️ Mock | All prompts versioned; `OPENAI_API_KEY` upgrade path documented |
| Multi-tenant auth | ❌ Deferred | Single-org demo; `organizations` table ready |

---

## Data Flow: Quick Run

```
POST /projects/quick-run { repo_url, name }
  │
  ├─► ensureSeeded() → demo org/project/env/recipients
  │
  ├─► createRun(idempotency_key="quick:repo_hash")
  │
  ├─► workspace.clone() → fixture repo (LogiTrack Web, 23 files)
  │
  ├─► analyze() → extract 6 extractors → 48 nodes, 37 edges
  │
  ├─► persistArch() → arch_snapshots + diagrams (D01–D09) + node_coverage
  │
  ├─► scaffold() → test files written to KV (simulated)
  │
  ├─► plan() → TestPlan (14 cases, layers: api/ui/e2e, tags, priority)
  │
  ├─► generate() → test code (Playwright TS) — mock LLM
  │
  ├─► quality.gate() → flaky score, category heuristic
  │
  ├─► healTest() → retry once with selector fix (mock)
  │
  ├─► commitDiff() → unified diff (simulated PR)
  │
  ├─► provision() → shards (4) written to `kv(shards:run_id)`
  │
  ├─► execute() → mock shards (instant) OR real runner polls
  │
  ├─► analyzeResults() → pass/flaky/fail, duration, categories
  │
  ├─► report() → diagrams rendered, email_messages queued
  │
  └─► notify() → drainOutbox() → Resend / console.log
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| API | RFC 7807 problem details; no stack traces in prod |
| Runner callback | HMAC-SHA256 (`RUNNER_CALLBACK_SECRET`) |
| Public report | Signed token (`report_links.token` = HMAC(run_id + secret)), 30-day TTL |
| Git webhook | `X-Hub-Signature-256` verified |
| Secrets | Never in DB — only Vercel env / runner env |
| DB | SQLite file permissions 0600; `/tmp` on Vercel |

---

## Performance Notes

- **Build time**: ~10s (Next.js 15, 34 routes)
- **Cold start**: <500ms (SQLite in-proc)
- **Run latency (mock)**: ~2-3s end-to-end (`VERIFLOW_STEP_DELAY_MS=10`)
- **Run latency (real)**: `shard_count × (clone + install + playwright)`
- **DB size**: ~200KB per run (results + diagrams + coverage)
- **Mermaid render**: Client-side (dynamic import), `securityLevel: "strict"`