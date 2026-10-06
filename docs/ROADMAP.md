# Veriflow Roadmap

> Mapping: **MVP** (current) → **V1** → **V2** per `02_TECHNICAL_ARCHITECTURE.md` §19

---

## MVP ✅ (Current Deploy)

| Area | Status | Notes |
|------|--------|-------|
| Next.js 15 on Vercel Hobby | ✅ | 34 routes, SQLite in-proc |
| Mock pipeline (14 steps) | ✅ | `VERIFLOW_STEP_DELAY_MS=10` ~2s |
| Fixture repo (LogiTrack Web) | ✅ | 23 files, 6 extractors |
| 9 Diagram kinds (D01–D09) | ✅ | Mermaid source, client render |
| Architecture extraction | ✅ | Prisma, OpenAPI, Routes, Compose, CI, Deps |
| Test generation (mock LLM) | ✅ | 8 prompt versions versioned |
| Quality gate + heal | ✅ | Flaky score, category, retry |
| Email outbox + Resend | ✅ | Idempotent, HTML + text |
| Public report (signed token) | ✅ | Customer-safe, printable |
| i18n (ID/EN) | ✅ | All UI, email, diagrams |
| Real runner (GH Actions + Docker) | ✅ | Pull/push contract, HMAC |
| Dashboard (overview, projects, runs) | ✅ | Cinematic logistics theme |

---

## V1 (Next 4-6 Weeks)

| Feature | Spec Ref | Effort | Dependencies |
|---------|----------|--------|--------------|
| **D06 Sequence Diagrams** | §18.2, §18.5 | M | Real Playwright traces from runner |
| **D10 Architecture Diff** | §18.3, FR-DGM-24 | S | `snapshotDiff()` exists; need UI + render |
| **Real LLM Adapters** | §5.1, §16 | M | OpenAI/Anthropol keys; prompt registry ready |
| **GitHub App Auth** | §7 webhook | S | Replace PAT with App installation token |
| **Postgres Migration** | §5.2 | L | Neon / Vercel Postgres / Turso; Prisma schema ready |
| **Multi-org / RBAC** | §4 | M | `organizations` table exists; add auth middleware |
| **Test Case Management** | FR-TST-14 | M | `test_cases` table stub; CRUD + versioning |
| **Flaky Quarantine Auto** | FR-QLT-08 | S | `test_stats.flaky_score` ≥ 0.3 → skip in plan |
| **Cost Dashboard** | FR-REP-18 | S | `ai_calls` tracked; add USD projection |
| **Webhook Retry + DLQ** | §7 | S | `kv` table + retry logic |

---

## V2 (Quarter 2)

| Feature | Spec Ref | Effort | Dependencies |
|---------|----------|--------|--------------|
| **Self-Hosted Runner Pool** | §5.2 | L | Kubernetes / ECS / Fly.io machines |
| **Visual Regression** | FR-TST-12 | L | Playwright `toMatchSnapshot` + Percy/Chromatic |
| **Contract Testing (Pact)** | FR-TST-13 | M | Consumer-driven contracts |
| **Performance Baselines** | FR-QLT-10 | M | k6 / Lighthouse CI integration |
| **Security Scanning (SAST/DAST)** | FR-DOP-12 | M | Semgrep / Trivy / OWASP ZAP in pipeline |
| **Custom Diagram Renderers** | §18.7 | M | D2 / Graphviz / ELK for >150 nodes |
| **Architecture Chat (RAG)** | §16 | L | Vector DB + arch snapshots as context |
| **Slack / Teams / Webhook Notifications** | FR-NTF-04 | S | Extend `mailer.ts` dispatcher |
| **Terraform / Helm Extractors** | §18.1 | M | Add to `extract.ts` for D08 |
| **Mobile App Support (Appium)** | FR-TST-11 | L | New layer `mobile` in test plan |

---

## Technical Debt / Hardening

| Item | Priority | Notes |
|------|----------|-------|
| Replace `node:sqlite` with Prisma + Postgres | High | Required for multi-instance Vercel |
| Add structured logging (pino) | Medium | Replace `run_logs` free-text |
| E2E tests for API routes | High | `tests/*.test.ts` with `node --test` |
| OpenAPI spec for Veriflow API | Medium | Generate from Zod schemas |
| Sentry / Vercel Analytics | Low | Error tracking + web vitals |
| Automated dependency updates | Low | Dependabot / Renovate |
| Load test runner at scale | Medium | 50+ concurrent shards |

---

## Spec Compliance Matrix

| Spec ID | Title | MVP | V1 | V2 | Notes |
|---------|-------|-----|----|----|-------|
| FR-PLN-01 | Analyze repo → stack | ✅ | | | 6 extractors |
| FR-PLN-02 | Test plan generation | ✅ | | | 14 cases mock |
| FR-PLN-03 | Heal & retry | ✅ | | | 1 retry mock |
| FR-EXE-01 | Sharded execution | ✅ | | | 4 shards mock/real |
| FR-EXE-02 | Real runner option | ✅ | | | GH Actions + Docker |
| FR-REP-01 | Run summary | ✅ | | | Pass rate, categories |
| FR-REP-02 | Diagram in email | ✅ | | | D01, D07, D08, D09 |
| FR-REP-03 | Public report | ✅ | | | Signed token |
| FR-DGM-01 | D01 System context | ✅ | | | Mermaid |
| FR-DGM-02 | D02 ERD | ✅ | | | Internal only |
| FR-DGM-03 | D03 Module deps | ✅ | | | Cycle detection |
| FR-DGM-04 | D04 API map | ✅ | | | |
| FR-DGM-05 | D05 UI map | ✅ | | | |
| FR-DGM-06 | D06 Sequence | | ✅ | | Needs HAR |
| FR-DGM-07 | D07 Pipeline | ✅ | | | |
| FR-DGM-08 | D08 Infra | ✅ | | | |
| FR-DGM-09 | D09 Coverage overlay | ✅ | | | On D01/D04/D02 |
| FR-DGM-10 | D10 Diff | | ✅ | | |
| FR-DGM-11 | Redaction by audience | ✅ | | | customer/internal |
| FR-DGM-12 | Truncation 150 nodes | ✅ | | | Centrality ranking |
| FR-DGM-13 | PNG/PDF export | | ✅ | | Diagram runner (501) |
| FR-DGM-14 | Max 3 diagrams email | ✅ | | | D01+D09, D07, D08 |
| FR-NTF-01 | Email report | ✅ | | | Resend + mock |
| FR-NTF-02 | Approval gate | ✅ | | | WAITING_APPROVAL |
| FR-NTF-03 | Webhook trigger | ✅ | | | GitHub push/PR |
| FR-QLT-01 | Flaky detection | ✅ | | | Score + quarantine |
| FR-QLT-02 | Category classification | ✅ | | | product/test/env/data |
| FR-QLT-03 | Coverage mapping | ✅ | | | test → node |
| FR-OPS-01 | Vercel deploy | ✅ | | | Hobby constraints |
| FR-OPS-02 | No persistent FS | ✅ | | | `/tmp` SQLite |
| FR-OPS-03 | No long workers | ✅ | | | SSE state machine |

---

## Release Checklist

### Pre-Release
- [ ] `npm run build` clean
- [ ] `npm test` passes
- [ ] Smoke test: quick-run → COMPLETED_WITH_WARNINGS
- [ ] Public report renders
- [ ] Runner pulls + pushes shard
- [ ] Email received (Resend dashboard)

### Post-Deploy
- [ ] Vercel deployment URL accessible
- [ ] Environment variables set
- [ ] GitHub Actions workflow runs
- [ ] Dashboard shows seeded data
- [ ] `/r/[token]` works for seeded runs

---

## Versioning

| Version | Branch | Trigger |
|---------|--------|---------|
| `0.x` | `main` | Continuous (Vercel auto-deploy) |
| `1.0.0` | `release/v1` | V1 complete |
| `2.0.0` | `release/v2` | V2 complete |

**Semantic Versioning**: Breaking API changes → major; new diagrams/features → minor; fixes → patch.