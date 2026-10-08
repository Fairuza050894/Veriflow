# 🚀 Deploy Veriflow 100% Free — Launch Checklist

> Target: **$0/month** menggunakan Vercel Hobby + Neon Postgres + GitHub Actions

---

## 1️⃣ Prasyarat (5 menit)

| Akun | Link |
|------|------|
| GitHub | https://github.com |
| Vercel | https://vercel.com (login via GitHub) |
| Neon | https://neon.tech (login via GitHub) |

---

## 2️⃣ Database: Neon Postgres (Free Tier — 0.5 GB)

1. **Buat project** di https://console.neon.tech
   - Project name: `veriflow`
   - Region: pilih terdekat (Singapore/Jakarta)
   - Postgres version: 16 (default)

2. **Connection String** (Dashboard → Connection Details)
   ```
   postgresql://<user>:<password>@<host>/veriflow?sslmode=require
   ```
   ⚠️ Simpan ini — butuh untuk `DATABASE_URL` nanti.

3. **Enable pooling** (Dashboard → Settings → Connection Pooling)
   - Transaction mode: ON
   - Max connections: 100 (default)

---

## 3️⃣ GitHub App (Untuk Private Repo & Webhook Aman)

1. **Settings → Developer settings → GitHub Apps → New GitHub App**
   - **App name**: `veriflow-[username]` (unik global)
   - **Homepage URL**: `https://<your-vercel-app>.vercel.app`
   - **Webhook URL**: `https://<your-vercel-app>.vercel.app/api/v1/webhooks/github`
   - **Webhook secret**: generate random 32-char (`openssl rand -hex 32`)
   - **Permissions**:
     | Permission | Access |
     |------------|--------|
     | Contents | Read-only |
     | Metadata | Read-only |
     | Pull requests | Read & Write |
     | Webhooks | Read & Write |
   - **Subscribe to events**: ✅ Push, ✅ Pull request
   - **Where can this GitHub App be installed?**: Only on this account (atau Any account)

2. **Generate Private Key** (di bottom page)
   - Download `.pem` file → convert ke single-line:
   ```bash
   cat veriflow-private-key.pem | awk '{printf "%s\\n", $0}' | sed ':a;N;$!ba;s/\n/\\n/g'
   ```
   Simpan output sebagai `GITHUB_APP_PRIVATE_KEY`.

3. **Install App** ke repo target (repo yang mau dites).

4. **Catat**:
   - `GITHUB_APP_ID` (App ID di General)
   - `GITHUB_APP_PRIVATE_KEY` (single-line dari step 2)
   - `GITHUB_APP_WEBHOOK_SECRET` (dari step 1)

---

## 4️⃣ Vercel Deploy (Free Hobby)

### 4.1 Push ke GitHub
```bash
git add .
git commit -m "feat: real LLM adapter + GitHub App auth"
git push origin main
```

### 4.2 Import di Vercel
1. https://vercel.com/new → Import Git Repository
2. Pilih repo `Veriflow`
3. **Framework Preset**: Next.js (auto-detect)
4. **Root Directory**: `./` (default)

### 4.3 Environment Variables (Vercel Dashboard → Settings → Environment Variables)

| Key | Value | Environment |
|-----|-------|-------------|
| `DATABASE_URL` | `postgresql://...` (dari Neon) | Production, Preview, Development |
| `PUBLIC_BASE_URL` | `https://<your-app>.vercel.app` | Production, Preview |
| `VERIFLOW_DB_PATH` | `/tmp/veriflow.db` | Production, Preview, Development |
| `RUNNER_CALLBACK_SECRET` | `openssl rand -hex 32` | Production, Preview, Development |
| `GITHUB_APP_ID` | `123456` | Production, Preview, Development |
| `GITHUB_APP_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----` | Production, Preview, Development |
| `GITHUB_APP_WEBHOOK_SECRET` | `<dari GitHub App>` | Production, Preview, Development |
| `LLM_PROVIDER` | `mock` (ubah nanti ke `openai`/`anthropic`) | Production, Preview, Development |
| `EMAIL_PROVIDER` | `outbox` | Production, Preview, Development |
| `VERIFLOW_SEED` | `true` | Production, Preview, Development |
| `VERIFLOW_STEP_DELAY_MS` | `10` | Production, Preview, Development |

⚠️ **Private Key format di Vercel**: Harus *single-line* dengan `\n` literal:
```
-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQD...\n-----END PRIVATE KEY-----
```

### 4.4 Deploy
- Klik **Deploy** → tunggu ~3 menit
- Vercel otomatis set `PUBLIC_BASE_URL` ke domain production

### 4.5 Update GitHub App Webhook URL
Setelah deploy, dapatkan URL production (mis. `https://veriflow-xyz.vercel.app`), lalu update GitHub App:
- **Webhook URL**: `https://veriflow-xyz.vercel.app/api/v1/webhooks/github`

---

## 5️⃣ GitHub Actions Runner (Free — 2000 min/bulan)

### 5.1 Secrets di GitHub Repo (Settings → Secrets → Actions)
| Secret | Value |
|--------|-------|
| `VERIFLOW_API_BASE` | `https://<your-app>.vercel.app` |
| `RUNNER_CALLBACK_SECRET` | *sama dengan Vercel env* |

### 5.2 Workflow sudah ada di `.github/workflows/autoqa.yml`
- Trigger: manual (`workflow_dispatch`) atau push/PR ke `main`
- Runner: `ubuntu-latest` (GitHub-hosted, free tier)

### 5.3 Test Runner
```bash
gh workflow run autoqa.yml
```
Atau buka Actions tab → Run workflow.

---

## 6️⃣ Optional: Real LLM (OpenAI / Anthropic)

| Provider | Free Tier | Setup |
|----------|-----------|-------|
| **OpenAI** | $5 credit baru (expired 30 hari) | `LLM_PROVIDER=openai`, `OPENAI_API_KEY=sk-...`, `LLM_MODEL=gpt-4o-mini` |
| **Anthropic** | $5 credit baru | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=sk-ant-...`, `LLM_MODEL=claude-3-5-haiku-20241022` |

> **Tip**: Tetap `mock` dulu untuk launch. Ganti setelah verifikasi pipeline jalan.

---

## 7️⃣ Launch Verification Checklist

| Step | Command / Check | Expected |
|------|-----------------|----------|
| 1. Health | `curl https://<app>.vercel.app/api/v1/metrics/overview` | `{"projects":0,...}` |
| 2. Quick Run | `curl -X POST https://<app>.vercel.app/api/v1/projects/quick-run -H "content-type: application/json" -d '{"repo_url":"https://github.com/Fairuza050894/LogiTrack"}'` | `{"run_id":"run_...","stream":"/api/v1/runs/.../stream",...}` |
| 3. SSE Stream | Buka `https://<app>.vercel.app/runs/<run_id>` | Live progress bar |
| 4. Report | Buka `/r/<token>` dari response | Halaman laporan dengan diagram |
| 5. Webhook | Push ke repo terinstall → Actions tab | Run otomatis dibuat |
| 6. Runner | `gh workflow run autoqa.yml` | GitHub Actions jalan, callback ke Vercel |

---

## 8️⃣ Biaya Bulanan (Estimasi)

| Service | Free Tier Limit | Estimasi Veriflow |
|---------|-----------------|-------------------|
| Vercel Hobby | 100 GB bandwidth, 100 GB-hours | ✅ Gratis |
| Neon Postgres | 0.5 GB storage, 190 compute hrs | ✅ Gratis (~10 MB data) |
| GitHub Actions | 2000 min/ubuntu | ✅ Gratis (~50 run/bulan) |
| GitHub App | Unlimited | ✅ Gratis |
| **Total** | | **$0/bulan** |

---

## 9️⃣ Troubleshooting Cepat

| Error | Solusi |
|-------|--------|
| `P1003: Database does not exist` | Pastikan `DATABASE_URL` benar & Neon project aktif |
| `401 Webhook signature` | Cek `GITHUB_APP_WEBHOOK_SECRET` sama di Vercel & GitHub App |
| `Installation token failed` | Private key format salah (harus single-line `\n`), atau App ID salah |
| `Runner callback 401` | `RUNNER_CALLBACK_SECRET` harus sama di Vercel & GitHub Secrets |
| `LLM quota exceeded` | Balik ke `LLM_PROVIDER=mock` atau upgrade billing |

---

## 🔟 Next Steps (Post-Launch)

1. **Custom Domain** (Vercel → Settings → Domains) — gratis
2. **Monitoring** — Vercel Analytics (gratis) + Sentry (gratis 5k events/bulan)
3. **Scale Runner** — Self-hosted di Fly.io (gratis 3 VM kecil) atau Railway
4. **Real LLM** — Aktifkan setelah credit gratis habis, set budget `LLM_BUDGET_USD_PER_RUN=0.50`

---

## 📞 Support

- **Docs**: `/docs` di repo
- **Issues**: GitHub Issues repo ini
- **Architecture**: `docs/ARCHITECTURE.md`

---

**Selamat launch! 🎉** Veriflow siap melayani QA otomatis gratis selamanya.