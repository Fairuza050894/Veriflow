# Veriflow Deployment Guide

> Target: **Vercel Hobby** (free tier) — no persistent FS, no long-running workers, 10s function timeout.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 22.5+ (for `node:sqlite` `DatabaseSync`) |
| npm | 10+ |
| Vercel CLI | `npm i -g vercel@latest` |
| GitHub CLI | `gh auth login` |

---

## Local Development

```bash
# 1. Clone & install
git clone https://github.com/Fairuza050894/Veriflow
cd Veriflow
npm ci

# 2. Environment
cp .env.example .env
# Edit .env — see below

# 3. Dev server (with Turbo)
npm run dev
# → http://localhost:3000

# 4. Quick smoke test
curl -X POST http://localhost:3000/api/v1/projects/quick-run \
  -H 'content-type: application/json' \
  -d '{"repo_url":"https://github.com/Fairuza050894/LogiTrack","name":"LogiTrack"}'
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VERIFLOW_DB_PATH` | ✅ (prod) | `./.data/veriflow.db` | **Vercel: `/tmp/veriflow.db`** (ephemeral) |
| `VERIFLOW_STEP_DELAY_MS` | ❌ | `220` | Step delay for demo speed (set `10` for CI) |
| `VERIFLOW_SEED` | ❌ | `true` | Set `false` to disable demo seed |
| `RUNNER_CALLBACK_SECRET` | ✅ (prod) | — | HMAC secret for runner callback |
| `EMAIL_PROVIDER` | ❌ | `mock` | `resend` \| `mock` |
| `RESEND_API_KEY` | if `resend` | — | Resend API key |
| `EMAIL_FROM` | ❌ | `Veriflow <qa@veriflow.dev>` | From address |
| `GITHUB_WEBHOOK_SECRET` | ❌ | — | HMAC for GitHub webhook |
| `NEXT_PUBLIC_APP_URL` | ✅ (prod) | `http://localhost:3000` | Public URL for report links |

**Vercel-specific**: Add all above in Vercel Dashboard → Project → Settings → Environment Variables (Production + Preview).

---

## Vercel Deployment

```bash
# 1. Login
vercel login

# 2. Link project (first time)
vercel link

# 3. Set env vars (or use dashboard)
vercel env add VERIFLOW_DB_PATH production
# → /tmp/veriflow.db

vercel env add RUNNER_CALLBACK_SECRET production
# → (paste 64-char hex)

vercel env add NEXT_PUBLIC_APP_URL production
# → https://your-app.vercel.app

vercel env add EMAIL_PROVIDER production
# → resend

vercel env add RESEND_API_KEY production
# → re_xxx

# 4. Deploy
vercel --prod
```

**Important**: Vercel Hobby **does not persist** `/tmp` across deployments. Each deploy gets a fresh SQLite file. This is acceptable for demo — seed data recreates on first request.

---

## Database: Vercel `/tmp` Caveat

| Environment | `VERIFLOW_DB_PATH` | Persistence |
|-------------|-------------------|-------------|
| Local dev | `./.data/veriflow.db` | ✅ Survives restarts |
| Vercel | `/tmp/veriflow.db` | ❌ Ephemeral per deploy |
| VPS (Docker) | `/data/veriflow.db` | ✅ Bind mount |

**Implication**: Dashboard history resets on each Vercel deploy. For production, migrate to **Neon / Vercel Postgres / Turso** (see `ROADMAP.md`).

---

## GitHub Actions Runner Setup

### 1. Repository Secrets
| Secret | Value |
|--------|-------|
| `VERIFLOW_API_BASE` | `https://your-app.vercel.app` |
| `RUNNER_CALLBACK_SECRET` | Same as Vercel env |
| `GITHUB_TOKEN` | Auto-provided (for private repo clone) |

### 2. Trigger Manually
```bash
gh workflow run autoqa.yml
# or with specific run
gh workflow run autoqa.yml -f run_id=run_abc123
```

### 3. Auto-trigger on Push (Optional)
Add to `.github/workflows/autoqa.yml`:
```yaml
on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize]
```
Then the `webhook/github` endpoint handles it automatically.

---

## VPS Runner (Docker) — Alternative

```bash
# On VPS (Ubuntu 22.04+)
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker

# Clone & build
git clone https://github.com/Fairuza050894/Veriflow
cd Veriflow
docker build -t veriflow-runner ./runner

# Run with systemd (auto-restart)
sudo tee /etc/systemd/system/veriflow-runner.service > /dev/null <<EOF
[Unit]
Description=Veriflow Runner
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Veriflow
ExecStart=/usr/bin/docker run --rm \
  --name veriflow-runner \
  -e VERIFLOW_API_BASE=https://your-app.vercel.app \
  -e RUNNER_CALLBACK_SECRET=your-secret \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /home/ubuntu/veriflow-data:/tmp/veriflow-runs \
  veriflow-runner
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now veriflow-runner
sudo journalctl -u veriflow-runner -f
```

---

## Domain & TLS

- Vercel provides `*.vercel.app` with auto TLS
- Custom domain: Vercel Dashboard → Domains → Add → configure DNS
- **No additional config needed** — Next.js handles `X-Forwarded-Proto`

---

## Monitoring & Logs

| Source | Access |
|--------|--------|
| Vercel Function Logs | Vercel Dashboard → Functions → Logs |
| Runner Logs (GH Actions) | Actions tab → workflow run |
| Runner Logs (Docker) | `journalctl -u veriflow-runner -f` |
| SQLite Inspection | `vercel env pull` → `sqlite3 .data/veriflow.db` (local only) |

---

## Rollback

```bash
# Vercel: instant rollback to previous deployment
vercel rollback [deployment-url]

# Or promote previous
vercel promote [previous-deployment-url]
```

---

## Cost Estimate (Vercel Hobby)

| Resource | Limit | Veriflow Usage |
|----------|-------|----------------|
| Function execution | 100 GB-hours/mo | ~0.1 GB-hours (mock runs) |
| Bandwidth | 100 GB/mo | ~10 MB/run |
| Storage | — | SQLite in `/tmp` (not counted) |
| **Total** | **Free** | **$0** |

> Real runner on GitHub Actions uses **Actions minutes** (2000/mo free on Free plan).

---

## Troubleshooting Deploy

| Error | Fix |
|-------|-----|
| `DatabaseSync not found` | Node < 22.5 — upgrade or use `better-sqlite3` |
| `PRAGMA busy_timeout` locked | Two `next start` processes — kill old |
| `module.register() deprecated` | Node 26 warning — harmless, ignore |
| `outputFileTracingRoot` warning | Set in `next.config.ts`: `outputFileTracingRoot: __dirname` |
| Runner `401 Invalid signature` | `RUNNER_CALLBACK_SECRET` mismatch between Vercel and runner |
| Report page 404 | Token expired (30d) or run deleted — re-run |