# Vercel Deployment Instructions

Run these commands in your terminal (requires network access to vercel.com):

## 1. Login to Vercel
```bash
cd /Users/user/Projects/Veriflow
vercel login
```
This will open a browser for OAuth. Complete the flow, then return to terminal.

## 2. Link Project
```bash
vercel link
```
Select "Create new project" → Name: `veriflow` → Framework: Next.js

## 3. Set Environment Variables (Production + Preview)
```bash
# Required for production
vercel env add VERIFLOW_DB_PATH production
# → /tmp/veriflow.db

vercel env add RUNNER_CALLBACK_SECRET production
# → (generate: openssl rand -hex 32)

vercel env add NEXT_PUBLIC_APP_URL production
# → https://your-app.vercel.app

# Optional: Real email (Resend)
vercel env add EMAIL_PROVIDER production
# → resend
vercel env add RESEND_API_KEY production
# → re_xxx

# Optional: Real LLM
vercel env add OPENAI_API_KEY production
# → sk-xxx
```

## 4. Deploy to Production
```bash
vercel --prod
```

## 5. GitHub Actions Runner Setup
In GitHub repo settings → Secrets → Actions, add:
- `VERIFLOW_API_BASE` = `https://your-app.vercel.app`
- `RUNNER_CALLBACK_SECRET` = same as Vercel env above

Trigger manually:
```bash
gh workflow run autoqa.yml
```

## 6. Verify Deployment
- Dashboard: `https://your-app.vercel.app`
- Quick run: POST to `/api/v1/projects/quick-run`
- Public report: `/r/{token}`

---

## Current Status: ✅ Ready to Deploy

All code committed to: https://github.com/Fairuza050894/Veriflow

### What's Built:
- Next.js 15 on Vercel Hobby (34 routes)
- SQLite (node:sqlite) - zero native deps
- 14-step QA pipeline with SSE live updates
- 6 architecture extractors, 9 diagram kinds (D01-D09)
- Real runner: GitHub Actions + Docker (pull-poll + HMAC)
- Full i18n (ID/EN), cinematic logistics theme
- Email outbox (Resend/mock), signed public reports
- Complete docs: ARCHITECTURE, DEPLOYMENT, RUNBOOK, ROADMAP, RUNNER + 6 ADRs
- 56 self-check tests passing