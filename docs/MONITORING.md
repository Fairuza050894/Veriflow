# Monitoring & Alerting Setup

## 1. Vercel Analytics (Free, Zero-config)

**Enable:** Dashboard → Project → Settings → Analytics → Enable
- Page views, Core Web Vitals, Real-user metrics
- Gratis: 1M events/bulan
- Auto-inject script ke `next/head`

**CLI check:**
```bash
vercel inspect <deployment-url> | grep -i analytics
```

---

## 2. Sentry (Free tier: 5k errors/bulan)

### 2.1 Create Project
1. https://sentry.io → New Project → Next.js
2. Copy **DSN** (format: `https://xxx@o123.ingest.sentry.io/456`)

### 2.2 Add to Vercel
```bash
vercel env add SENTRY_DSN production
# paste DSN
vercel env add SENTRY_ORG production
# org slug dari URL sentry.io/settings/<org>/
vercel env add SENTRY_PROJECT production
# project slug
vercel env add SENTRY_AUTH_TOKEN production
# User Settings → Auth Tokens → New Token (scope: project:write)
```

### 2.3 Install SDK (sudah ada di package.json via next.config)
```bash
npm i @sentry/nextjs
npx @sentry/wizard -i nextjs
```
Wizard akan update `next.config.ts` + `sentry.edge.config.ts` + `sentry.server.config.ts`.

### 2.4 Verify
```bash
# Trigger error di production
curl https://veriflow-theta.vercel.app/api/v1/debug/sentry-test
# Cek Sentry dashboard → Issues
```

---

## 3. Vercel Logs Drain (opsional)

Stream logs ke external (Datadog, Logtail, Better Stack):
```bash
vercel logs drain create --destination-url=https://<your-endpoint> --project=veriflow
```

---

## 4. Custom Alerting Rules (via Sentry)

| Alert | Condition | Action |
|-------|-----------|--------|
| Run failure spike | >5 errors/5min | Email + Slack |
| High latency | p95 > 30s | Email |
| DB connection errors | >10/min | PagerDuty |

Setup: Sentry → Alerts → Create Alert Rule → metric: `error.count()` / `transaction.duration`

---

## 5. Uptime Monitoring (gratis)

| Tool | Free tier | Setup |
|------|-----------|-------|
| **UptimeRobot** | 50 monitors, 5min interval | Add `https://veriflow-theta.vercel.app/api/v1/metrics/overview` |
| **Better Stack** | 10 monitors, 30s interval | Dashboard + status page |
| **Cronitor** | 5 monitors | Heartbeat dari GitHub Actions |

---

## 6. Veriflow Internal Metrics (sudah ada)

```bash
# Health
curl https://veriflow-theta.vercel.app/api/v1/metrics/overview

# Run success rate 7d
curl https://veriflow-theta.vercel.app/api/v1/metrics/overview | jq '.passRate7d'

# Queue depth
curl https://veriflow-theta.vercel.app/api/v1/metrics/overview | jq '.queueDepth'
```

Bisa dipakai untuk custom Grafana dashboard (via Prometheus exporter nanti).

---

## 7. Checklist Post-Launch

- [ ] Vercel Analytics enabled
- [ ] Sentry project created + DSN added to Vercel
- [ ] `@sentry/nextjs` installed + wizard run
- [ ] Test error appears in Sentry
- [ ] Alert rules configured (failure spike, latency)
- [ ] Uptime monitor added (UptimeRobot/Better Stack)
- [ ] Status page public (opsional: Better Stack status page)