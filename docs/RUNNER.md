# Veriflow Real Runner

Veriflow includes a **real runner** that executes Playwright tests on actual infrastructure (VPS or GitHub Actions) and posts results back to the Vercel-hosted API. This proves the full loop: *type repo URL → run → real test execution → real report → email*.

---

## Architecture

```
┌─────────────┐     1. poll          ┌─────────────┐
│  Vercel API │ ◄──────────────────  │   Runner    │
│  (Next.js)  │     GET /internals/  │  (worker)   │
│             │     results?run_id=  │             │
└──────┬──────┘                      └──────┬──────┘
       │                                    │
       │  2. shard assigned                 │
       │  (testIds, repo, commit, baseUrl)  │
       ▼                                    ▼
┌─────────────┐                      ┌─────────────┐
│  Database   │                      │  Git clone  │
│  (SQLite)   │                      │  + npm ci   │
└─────────────┘                      └──────┬──────┘
                                            │
                                            ▼
                                     ┌─────────────┐
                                     │ Playwright  │
                                     │  (sharded)  │
                                     └──────┬──────┘
                                            │
                                            │ 3. POST results
                                            │    (HMAC signed)
                                            ▼
                                     ┌─────────────┐
                                     │  Vercel API │
                                     │  (store &   │
                                     │   advance)  │
                                     └─────────────┘
```

---

## Contract: `/api/v1/internals/results`

### Pull (runner → API)
```
GET /api/v1/internals/results?run_id=<runId>
```
Response (shard available):
```json
{
  "shard": {
    "index": 0,
    "total": 4,
    "testIds": ["tr_abc123", "tr_def456"],
    "estimatedMs": 120000,
    "projectRepoUrl": "https://github.com/org/repo",
    "commitSha": "a1b2c3d4...",
    "branch": "main",
    "baseUrl": "https://staging.example.com",
    "env": { "STAGING_API_KEY": "..." }
  }
}
```
Response (no shard ready):
```json
{ "shard": null }
```

List executing runs:
```
GET /api/v1/internals/results?list=executing
```
```json
{ "runs": [{ "id": "run_xxx", "project_id": "prj_yyy" }] }
```

### Push (runner → API)
```
POST /api/v1/internals/results
Content-Type: application/json
X-Veriflow-Signature: <hmac-sha256(payload, RUNNER_CALLBACK_SECRET)>
```
Payload:
```json
{
  "runId": "run_xxx",
  "shardIndex": 0,
  "status": "passed",
  "results": [
    {
      "testId": "tr_abc123",
      "title": "GET /api/shipments — respons sesuai kontrak",
      "file": "autoqa/tests/api/shipments.spec.ts",
      "status": "passed",
      "duration_ms": 1245,
      "retries": 0,
      "error_message": null
    }
  ],
  "durationMs": 45000
}
```

**HMAC verification**: The API verifies `X-Veriflow-Signature` using `RUNNER_CALLBACK_SECRET`. Payload must match exactly (no whitespace normalization).

---

## Deployment Options

### Option A: GitHub Actions (Recommended for Demo)

**Secrets required** (repository Settings → Secrets → Actions):
| Secret | Value |
|--------|-------|
| `VERIFLOW_API_BASE` | `https://your-app.vercel.app` |
| `RUNNER_CALLBACK_SECRET` | 64-char random string (same as Vercel env) |

**Trigger manually**:
```bash
gh workflow run autoqa.yml -f run_id=run_abc123
```
Or let it poll for any `EXECUTING` run:
```bash
gh workflow run autoqa.yml
```

**Workflow file**: `.github/workflows/autoqa.yml`

### Option B: Docker on VPS (Persistent Runner)

```bash
# Build
docker build -t veriflow-runner ./runner

# Run (restarts on crash)
docker run -d --name veriflow-runner --restart unless-stopped \
  -e VERIFLOW_API_BASE=https://your-app.vercel.app \
  -e RUNNER_CALLBACK_SECRET=your-secret \
  -e RUNNER_POLL_MS=5000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  veriflow-runner

# Logs
docker logs -f veriflow-runner
```

**Environment variables**:
| Variable | Default | Description |
|----------|---------|-------------|
| `VERIFLOW_API_BASE` | `http://localhost:3000` | Vercel deployment URL |
| `RUNNER_CALLBACK_SECRET` | *required* | HMAC secret (must match Vercel) |
| `RUNNER_POLL_MS` | `5000` | Poll interval |
| `RUNNER_MAX_SHARD_MS` | `300000` | Max shard execution time |
| `RUNNER_WORK_DIR` | `/tmp/veriflow-runs` | Working directory for clones |

---

## Vercel Configuration

Add to Vercel project **Environment Variables**:

| Name | Value | Scope |
|------|-------|-------|
| `RUNNER_CALLBACK_SECRET` | `openssl rand -hex 32` | Production, Preview |

The API route `/api/v1/internals/results` validates this secret on every push.

---

## Sharding Strategy

- **Default**: 4 shards (configurable via `max_tests_per_run` in project settings)
- **Assignment**: Round-robin by `testId` hash
- **Playwright**: `--shard=N/M` + `--grep` filter on `@veriflow-id:<testId>`
- **Timeout**: `RUNNER_MAX_SHARD_MS` (default 5 min) per shard

---

## Local Development

```bash
# Terminal 1: Start Vercel dev (or `npm run dev`)
npm run dev

# Terminal 2: Start runner against local API
cd runner
VERIFLOW_API_BASE=http://localhost:3000 \
RUNNER_CALLBACK_SECRET=dev-secret \
RUNNER_POLL_MS=3000 \
node worker.mjs --once --run-id=run_xxx
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Invalid signature` | Secret mismatch | Ensure `RUNNER_CALLBACK_SECRET` identical in Vercel and runner |
| `shard: null` repeatedly | No shards queued | Check run status is `EXECUTING`; shards created at `PROVISIONING`→`EXECUTING` transition |
| Playwright `ENOENT` | Missing Chromium | `npx playwright install --with-deps chromium` (in Dockerfile) |
| Git clone fails (private repo) | No credentials | Add `GITHUB_TOKEN` to runner env; use `https://x-access-token:$GITHUB_TOKEN@github.com/...` |
| `database is locked` | Concurrent Next.js + runner | Runner only reads/writes via API — never touches SQLite directly |

---

## Security Notes

- **No persistent credentials** in runner image — all secrets via env vars
- **HMAC-SHA256** on every push — replay attacks prevented by nonce (run_id + shard_index)
- **Ephemeral workspace** — each shard clones fresh; `node_modules` not persisted across runs
- **Network egress** — runner only calls `VERIFLOW_API_BASE` + `github.com` (for clone)

---

## Extending

To add a new test layer (e.g., `contract`, `load`):
1. Generator emits `@veriflow-id:<testId>` tag + `@layer:<name>`
2. Engine includes in shard `testIds`
3. Runner `--grep` filters work unchanged
4. Results stored with `layer` column for dashboard filtering