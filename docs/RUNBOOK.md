# Veriflow Runbook

> Operational procedures for on-call / maintainers.

---

## Common Operations

### Trigger a Run Manually

**Via API (quick-run, mock)**:
```bash
curl -X POST https://your-app.vercel.app/api/v1/projects/quick-run \
  -H 'content-type: application/json' \
  -d '{"repo_url":"https://github.com/org/repo","name":"MyApp"}'
```

**Via API (existing project)**:
```bash
curl -X POST https://your-app.vercel.app/api/v1/projects/prj_xxx/runs \
  -H 'content-type: application/json' \
  -d '{"commit_sha":"abc123","branch":"main","mode":"FULL_AUTO"}'
```

**Via GitHub Actions**:
```bash
gh workflow run autoqa.yml -f run_id=run_xxx
```

### Check Run Status

```bash
# API
curl https://your-app.vercel.app/api/v1/runs/run_xxx | jq .

# Dashboard
open https://your-app.vercel.app/runs/run_xxx
```

### Cancel a Stuck Run

```bash
curl -X POST https://your-app.vercel.app/api/v1/runs/run_xxx/cancel
```
Sets status → `CANCELLED`, stops `advanceRun` loop.

### Approve / Reject at WAITING_APPROVAL

```bash
# Approve → continues to COMMITTING
curl -X POST https://your-app.vercel.app/api/v1/runs/run_xxx/approve

# Reject → marks REJECTED, sends notification
curl -X POST https://your-app.vercel.app/api/v1/runs/run_xxx/reject
```

### Resend Email Report

```bash
curl -X POST https://your-app.vercel.app/api/v1/runs/run_xxx/emails/resend \
  -H 'content-type: application/json' \
  -d '{"kind":"report"}'
```
Idempotency key prevents duplicate sends.

### View Public Report (Customer Link)

```bash
# Get token from run detail or API
curl https://your-app.vercel.app/r/abc123token...
```
No auth required. 30-day TTL.

---

## Debugging

### Run Stuck at Step

1. Check `/api/v1/runs/[id]` → `steps` array for `status: "running"`
2. Check `run_logs` table for errors:
   ```bash
   sqlite3 .data/veriflow.db "select * from run_logs where run_id='run_xxx' order by id desc limit 20;"
   ```
3. If `EXECUTING` with real runner: check runner logs (GH Actions / Docker)
4. Force-advance (dev only):
   ```bash
   sqlite3 .data/veriflow.db "update runs set status='COMPLETED' where id='run_xxx';"
   ```

### Database Locked

```bash
# Kill any lingering next processes
pkill -f "next-server"
# Remove WAL/SHM
rm -f .data/veriflow.db-wal .data/veriflow.db-shm
# Restart
npm run dev
```

### Runner Not Picking Up Shards

1. Verify run status = `EXECUTING`
2. Check runner logs: `gh run view --log` or `docker logs veriflow-runner`
3. Verify `RUNNER_CALLBACK_SECRET` matches Vercel env
4. Test callback manually:
   ```bash
   curl -X POST https://your-app.vercel.app/api/v1/internals/results \
     -H 'content-type: application/json' \
     -H 'x-veriflow-signature: <hmac>' \
     -d '{"runId":"run_xxx","shardIndex":0,"status":"passed","results":[],"durationMs":1000}'
   ```

### Email Not Sending

1. Check `email_messages` table: `status` = `queued` / `sent` / `failed`
2. If `queued`: `drainOutbox()` runs at `NOTIFYING` step — ensure run reached it
3. If `failed`: check `attempts` and `error_message` column
4. Resend: POST `/api/v1/runs/[id]/emails/resend`

### Public Report 404

- Token expired (30 days) → re-run
- Run deleted → re-run
- Wrong URL → check `report_url` in run detail

---

## Database Maintenance

### View Schema
```bash
sqlite3 .data/veriflow.db ".schema"
```

### Count Rows per Table
```bash
sqlite3 .data/veriflow.db "
  select 'runs', count(*) from runs union all
  select 'test_results', count(*) from test_results union all
  select 'diagrams', count(*) from diagrams union all
  select 'email_messages', count(*) from email_messages union all
  select 'arch_snapshots', count(*) from arch_snapshots;
"
```

### Prune Old Runs (Keep Last 100)
```bash
sqlite3 .data/veriflow.db "
  delete from run_steps where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from test_results where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from diagrams where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from node_coverage where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from email_messages where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from run_logs where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from arch_snapshots where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from arch_findings where snapshot_id in (select id from arch_snapshots);
  delete from devops_findings where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from report_links where run_id in (select id from runs order by created_at desc limit -1 offset 100);
  delete from runs where id in (select id from runs order by created_at desc limit -1 offset 100);
"
```

### Vacuum (Reclaim Space)
```bash
sqlite3 .data/veriflow.db "VACUUM;"
```

---

## Scaling Considerations

| Bottleneck | Symptom | Mitigation |
|------------|---------|------------|
| SQLite write contention | `database is locked` | Migrate to Postgres (Neon) |
| Vercel 10s timeout | Long runs timeout | Offload to runner (already done) |
| Runner queue backlog | `queueDepth` > 10 | Add more runner replicas (GH Actions: increase concurrency) |
| Email rate limit | Resend 429 | Batch `drainOutbox` / upgrade Resend plan |
| Mermaid render OOM | Large diagrams (>150 nodes) | Truncation at 150; client-side only |

---

## Incident Response

### SEV-1: API Down (5xx on all routes)
1. Check Vercel status page
2. Check function logs for crash loop
3. Rollback: `vercel rollback`
4. If DB corruption: redeploy (fresh `/tmp` DB auto-seeds)

### SEV-2: Runner Not Working
1. Check GH Actions / Docker runner health
2. Verify secrets not rotated
3. Re-deploy runner image

### SEV-3: Email Not Delivering
1. Check Resend dashboard / logs
2. Verify `RESEND_API_KEY` valid
3. Fallback: `EMAIL_PROVIDER=mock` logs to console

---

## Backup / Restore

**Vercel**: No persistent backup needed (ephemeral DB, auto-seed).

**VPS (Docker)**:
```bash
# Backup
docker exec veriflow-runner sqlite3 /tmp/veriflow-runs/veriflow.db ".backup /tmp/backup.db"
docker cp veriflow-runner:/tmp/backup.db ./backup-$(date +%F).db

# Restore
docker cp ./backup-2026-10-06.db veriflow-runner:/tmp/veriflow.db
docker restart veriflow-runner
```

---

## Useful Queries

### Flaky Tests (Last 30 Days)
```sql
SELECT title, AVG(flaky_score) as score, COUNT(*) as runs
FROM test_stats
WHERE flaky_score > 0.15
GROUP BY title
ORDER BY score DESC;
```

### Slowest Test Suites
```sql
SELECT file, AVG(duration_ms) as avg_ms, COUNT(*) as n
FROM test_results
GROUP BY file
ORDER BY avg_ms DESC
LIMIT 10;
```

### Architecture Drift (New Findings)
```sql
SELECT type, COUNT(*) as count, MAX(created_at) as latest
FROM arch_findings
GROUP BY type
ORDER BY latest DESC;
```

### Cost by Run
```sql
SELECT id, project_id, json_extract(cost, '$.cost_usd') as usd, json_extract(cost, '$.ai_calls') as calls
FROM runs
WHERE cost IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```