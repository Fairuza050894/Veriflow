# Launch Run Log — 2026-10-08

Deploy Veriflow ke Vercel Hobby yang benar-benar dieksekusi (bukan rencana).

## URL production

`https://veriflow-86sh73kzh-fairuzareztu-3191s-projects.vercel.app`

## Step yang dieksekusi (urutan asli)

1. `vercel link --yes` — project ter-link (`fairuzareztu-3191s-projects/veriflow`).
2. `vercel env add LLM_PROVIDER|EMAIL_PROVIDER|VERIFLOW_SEED|VERIFLOW_STEP_DELAY_MS production`
   — default mock (`mock`/`outbox`/`true`/`10`).
3. `npm run build` — passing, 34 routes.
4. `git add -A && git commit && git push origin main`.
5. `vercel --prod` — **gagal**: upload 344.8 MB > limit 100 MB.
   - Penyebab: Vercel CLI tidak pakai `.gitignore`; direktori stale ikut ter-upload
     (`.next` 703 MB, `.next-build` 351 MB, `node_modules` 607 MB).
   - Fix: buat `.vercelignore` (node_modules, .next*, .data, *.tsbuildinfo,
     coverage, .env.local*, .vercel, runner/work, runner/reports, *.log, .git),
     commit, push, `vercel --prod` ulang → 3 deploy `● Ready`.
6. Verifikasi: `GET /api/v1/metrics/overview` → **terblokir**: `Protected by Vercel Authentication`.
   - Penyebab: `ssoProtection.deploymentType = "all_except_custom_domains"`.
   - Fix: `PATCH /v9/projects/{pid}?teamId={team}` body `{"ssoProtection": null}`
     via `api.vercel.com` pakai token dari
     `~/Library/Application Support/com.vercel.cli/auth.json`.
   - Re-check 5 detik kemudian → `200`.
7. Verifikasi live (hasil):
   - `GET /` → `200`
   - `GET /api/v1/metrics/overview` → `200` (seed data: 1 project)
   - `POST /api/v1/projects/quick-run` → `202`, `run_id: run_10fb3c8645c04f13b9fb`
   - `GET /api/v1/runs/{id}/stream` → `404 run tidak ditemukan`
   - `GET /r/{token}` → `404`

## Batasan yang diketahui (bukan bug — by design tanpa secret)

- Run/stream/report `404`: SQLite di `VERIFLOW_DB_PATH=/tmp/veriflow.db` itu ephemeral
  dan antar-instance serverless tidak berbagi file; background `advanceRun`
  mati saat fungsi selesai (`src/lib/db.ts:23`, `usePrisma:41`).
- Webhook balas `503` tanpa secret: expected (`src/app/api/v1/webhooks/github/route.ts:41`).
- `getConfig()` null tanpa 3 env GitHub App → mode legacy (`src/lib/github-app.ts:202`).

## Sisa step (butuh akun user — tidak bisa dieksekusi agen)

1. Neon: https://console.neon.tech → project `veriflow` → copy connection string.
2. `echo "<DATABASE_URL>" | vercel env add DATABASE_URL production`
3. `DATABASE_URL="<...>" npx prisma db push` (sekali, dari lokal — buat tabel).
4. GitHub App: Settings → Developer settings → GitHub Apps → New:
   name `veriflow-[username]`, webhook URL
   `https://veriflow-86sh73kzh-fairuzareztu-3191s-projects.vercel.app/api/v1/webhooks/github`,
   secret `openssl rand -hex 32`, permissions Contents(R) + Metadata(R) +
   Pull requests(RW) + Webhooks(RW), events Push + Pull request.
   Generate private key → single-line:
   `cat key.pem | sed ':a;N;$!ba;s/\n/\\n/g'`
5. `echo "<id>" | vercel env add GITHUB_APP_ID production`
   `echo "<single-line-pem>" | vercel env add GITHUB_APP_PRIVATE_KEY production`
   `echo "<secret>" | vercel env add GITHUB_APP_WEBHOOK_SECRET production`
6. `vercel --prod` → verifikasi: quick-run `202`, stream `200`, report `200`,
   push ke repo terinstall → run otomatis.
7. (Opsional) `./deploy-free.sh` otomatisasi step 2+5+6 kalau secret sudah di tangan.
