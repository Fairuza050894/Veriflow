# Veriflow

> **Kendali kualitas rantai pasok Anda, otomatis.**
> **Automate supply-chain quality control.**

Veriflow is an **AI-powered QA automation platform** for logistics/web applications. Point it at a repository → it detects the stack, designs a test plan, generates Playwright tests (API + UI + E2E), executes them in sharded runners, and delivers a cinematic report with architecture diagrams to stakeholders via email.

**Live Demo**: [https://veriflow.vercel.app](https://veriflow.vercel.app) *(deployed on Vercel Hobby)*

---

## ✨ Features

| Category | Capability |
|----------|------------|
| **Pipeline** | 14-step autonomous QA: clone → analyze → scaffold → plan → generate → heal → execute → report |
| **Architecture** | 9 diagram kinds (D01–D09): system context, ERD, module deps, API map, UI map, pipeline, infra, coverage overlay |
| **Execution** | Mock (instant, deterministic) **or** real Playwright via GitHub Actions / Docker runner |
| **Reporting** | Signed public links (customer-safe), HTML email with diagrams, flaky classification, cost tracking |
| **i18n** | Full Indonesian + English (UI, emails, diagrams, prompts) |
| **Zero Credentials** | All adapters have mock fallbacks; real providers via env vars only |

---

## 🎬 Quick Start

```bash
# 1. Clone & install
git clone https://github.com/Fairuza050894/Veriflow
cd Veriflow
npm ci

# 2. Environment (optional — mocks work out of the box)
cp .env.example .env

# 3. Dev server
npm run dev
# → http://localhost:3000

# 4. One-click demo run (uses fixture LogiTrack Web repo)
curl -X POST http://localhost:3000/api/v1/projects/quick-run \
  -H 'content-type: application/json' \
  -d '{"repo_url":"https://github.com/Fairuza050894/LogiTrack","name":"LogiTrack"}'
```

**Watch it run**: Open `http://localhost:3000/runs/<run_id>` — live SSE progress bar.

---

## 🏗 Architecture

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
```

**Key Decisions** (see `docs/adr/`):
- [ADR 001](docs/adr/001-nextjs-vercel.md): Next.js 15 monorepo-lite on Vercel Hobby
- [ADR 002](docs/adr/002-sqlite.md): `node:sqlite` `DatabaseSync` (zero native deps)
- [ADR 003](docs/adr/003-sse-state-machine.md): SSE-driven state machine (no Temporal)
- [ADR 004](docs/adr/004-runner-contract.md): Pull-poll runner contract
- [ADR 005](docs/adr/005-diagrams-mermaid.md): Mermaid source stored, client-side render
- [ADR 006](docs/adr/006-i18n-mock-adapters.md): Full i18n + mock adapters with env upgrade

---

## 📁 Project Structure

```
Veriflow/
├── src/
│   ├── app/                    # Next.js App Router (34 routes)
│   │   ├── api/v1/             # REST + SSE + webhook endpoints
│   │   ├── r/[token]/          # Public report (signed)
│   │   └── ...                 # Pages: /, /projects, /runs/[id], /architecture, ...
│   ├── components/             # React components (UI, charts, Mermaid, actions)
│   ├── lib/
│   │   ├── pipeline/           # 14-step engine (analyze→scaffold→plan→generate→quality→execute→results→report)
│   │   ├── arch/               # 6 extractors + 9 diagram composers
│   │   ├── db.ts               # SQLite (DatabaseSync) + schema
│   │   ├── mailer.ts           # Outbox pattern + Resend/mock
│   │   ├── i18n.ts             # ID/EN dictionaries
│   │   └── prompts/            # 8 versioned prompt templates
│   └── fixtures/               # Demo repo (LogiTrack Web, 23 files)
├── runner/                     # Real Playwright runner
│   ├── worker.mjs              # Pull-poll executor
│   ├── Dockerfile              # Alpine + Chromium
│   └── entrypoint.sh
├── .github/workflows/autoqa.yml # GitHub Actions runner
├── docs/                       # Full documentation
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── RUNBOOK.md
│   ├── ROADMAP.md
│   ├── RUNNER.md
│   └── adr/                    # Architecture Decision Records
├── prompts/                    # Prompt registry (v1–v8)
├── tests/                      # Self-check tests (node --test)
└── package.json
```

---

## 🔧 Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VERIFLOW_DB_PATH` | ✅ (prod) | `./.data/veriflow.db` | **Vercel: `/tmp/veriflow.db`** |
| `VERIFLOW_STEP_DELAY_MS` | ❌ | `220` | Step delay (set `10` for fast CI) |
| `VERIFLOW_SEED` | ❌ | `true` | Disable demo seed with `false` |
| `RUNNER_CALLBACK_SECRET` | ✅ (prod) | — | HMAC secret for runner |
| `EMAIL_PROVIDER` | ❌ | `mock` | `resend` \| `mock` |
| `RESEND_API_KEY` | if `resend` | — | Resend API key |
| `GITHUB_WEBHOOK_SECRET` | ❌ | — | HMAC for GitHub webhook |
| `NEXT_PUBLIC_APP_URL` | ✅ (prod) | `http://localhost:3000` | Public URL for report links |

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for full guide.

---

## 🧪 Testing

```bash
# Type-check
npx tsc --noEmit

# Build
npm run build

# Self-check tests (assert-based, no framework)
npm test
# → runs: tests/*.test.ts via `node --test --experimental-strip-types`
```

---

## 🚀 Deploy to Vercel

```bash
# 1. Install Vercel CLI
npm i -g vercel@latest

# 2. Login & link
vercel login
vercel link

# 3. Set env vars (or use dashboard)
vercel env add VERIFLOW_DB_PATH production
# → /tmp/veriflow.db

vercel env add RUNNER_CALLBACK_SECRET production
# → (openssl rand -hex 32)

vercel env add NEXT_PUBLIC_APP_URL production
# → https://your-app.vercel.app

# 4. Deploy
vercel --prod
```

**GitHub Actions Runner** (optional, for real Playwright):
1. Add secrets: `VERIFLOW_API_BASE`, `RUNNER_CALLBACK_SECRET`
2. Trigger: `gh workflow run autoqa.yml`

---

## 📚 Documentation

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System context, components, data flow, API surface |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel, GitHub Actions, VPS Docker, env vars |
| [RUNBOOK.md](docs/RUNBOOK.md) | Operations: trigger, cancel, debug, DB maintenance |
| [ROADMAP.md](docs/ROADMAP.md) | MVP → V1 → V2, spec compliance matrix |
| [RUNNER.md](docs/RUNNER.md) | Real runner contract, deployment, troubleshooting |
| [ADRs](docs/adr/) | 6 Architecture Decision Records |

---

## 🗺 Spec Compliance (MVP)

| Spec Area | Status | Notes |
|-----------|--------|-------|
| FR-PLN-01..03 | ✅ | Analyze, plan, heal (mock LLM) |
| FR-EXE-01..02 | ✅ | Sharded execution + real runner option |
| FR-REP-01..03 | ✅ | Summary, diagrams in email, public report |
| FR-DGM-01..14 | ✅ | D01–D09 implemented; D10 stub |
| FR-NTF-01..03 | ✅ | Email, approval gate, webhook |
| FR-QLT-01..03 | ✅ | Flaky, category, coverage mapping |
| FR-OPS-01..03 | ✅ | Vercel Hobby, no persistent FS, no workers |

Full matrix: [ROADMAP.md#spec-compliance-matrix](docs/ROADMAP.md#spec-compliance-matrix)

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15.5 (App Router, React 19) |
| Language | TypeScript 5.9 (strict) |
| Database | `node:sqlite` `DatabaseSync` (Node 26) |
| Styling | Tailwind CSS 4.1 (custom cinematic logistics theme) |
| Diagrams | Mermaid 11.4 (client-side, `securityLevel: "strict"`) |
| Charts | Hand-rolled SVG (PassTrend, BarList, Donut, Sparkline) |
| Email | Resend (prod) / console mock (dev) |
| Testing | Playwright (runner), `node --test` (self-check) |
| CI/CD | GitHub Actions + Vercel |

---

## 🤝 Contributing

```bash
# 1. Fork & branch
git checkout -b feat/amazing-feature

# 2. Develop
npm run dev

# 3. Verify
npm run build && npm test

# 4. PR
gh pr create --title "feat: amazing feature" --body "Closes #123"
```

**Code Style**: TypeScript strict, ESLint (Next.js core), Prettier. No external formatting config — uses Next.js defaults.

---

## 📄 License

MIT © 2026 Fairuza050894

---

## 🙏 Acknowledgments

- **Specs**: `01_PRD_SPEC_REQUIREMENTS.md`, `02_TECHNICAL_ARCHITECTURE.md`
- **Fixture**: LogiTrack Web (logistics demo app)
- **Theme**: Cinematic logistics — dark slate, dispatch gold, amber glow
- **Runtime**: Node 26 `DatabaseSync` — the hero that made Vercel + SQLite possible