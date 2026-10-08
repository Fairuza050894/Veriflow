#!/usr/bin/env bash
# deploy-free.sh — Deploy Veriflow to Vercel (Free Tier) + Neon + GitHub App
# Usage: ./deploy-free.sh

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[err]${NC} $*"; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Command '$1' not found. Install it first."; exit 1; }
}

check_cmd vercel
check_cmd openssl

# ─── Prompt for 4 secrets ───
echo ""
log "=== Veriflow Free Deploy ==="
log "Butuh 4 nilai rahasia dari layanan eksternal:"
echo ""

read -rp "1) DATABASE_URL (Neon connection string): " DATABASE_URL
[[ -z "$DATABASE_URL" ]] && { err "DATABASE_URL wajib diisi"; exit 1; }

read -rp "2) GITHUB_APP_ID (angka, mis: 123456): " GITHUB_APP_ID
[[ -z "$GITHUB_APP_ID" ]] && { err "GITHUB_APP_ID wajib diisi"; exit 1; }

read -rp "3) GITHUB_APP_PRIVATE_KEY (single-line PEM, paste output dari sed): " GITHUB_APP_PRIVATE_KEY
[[ -z "$GITHUB_APP_PRIVATE_KEY" ]] && { err "GITHUB_APP_PRIVATE_KEY wajib diisi"; exit 1; }

read -rp "4) GITHUB_APP_WEBHOOK_SECRET (64 hex chars, atau generate otomatis): " GITHUB_APP_WEBHOOK_SECRET
if [[ -z "$GITHUB_APP_WEBHOOK_SECRET" ]]; then
  GITHUB_APP_WEBHOOK_SECRET=$(openssl rand -hex 32)
  warn "Generate otomatis: $GITHUB_APP_WEBHOOK_SECRET"
fi

# ─── Add to Vercel ───
log "Menambahkan environment variables ke Vercel (production)..."

vercel env add DATABASE_URL production <<<"$DATABASE_URL"
vercel env add GITHUB_APP_ID production <<<"$GITHUB_APP_ID"
vercel env add GITHUB_APP_PRIVATE_KEY production <<<"$GITHUB_APP_PRIVATE_KEY"
vercel env add GITHUB_APP_WEBHOOK_SECRET production <<<"$GITHUB_APP_WEBHOOK_SECRET"

log "Environment variables ditambahkan."

# ─── Deploy ───
log "Deploy ke Vercel production..."
vercel --prod

# ─── Health check ───
# Get production URL
PROD_URL=$(vercel ls --scope=fairuzareztu-3191s-projects/veriflow 2>/dev/null | grep veriflow | grep -Eo 'https://[^ ]+' | head -1)

if [[ -z "$PROD_URL" ]]; then
  warn "Tidak bisa detek URL production otomatis. Cek manual di Vercel dashboard."
  PROD_URL="https://<your-app>.vercel.app"
fi

log "Menunggu deploy siap (10 detik)..."
sleep 10

log "Health check: $PROD_URL/api/v1/metrics/overview"
for i in {1..6}; do
  if curl -sf "$PROD_URL/api/v1/metrics/overview" >/dev/null; then
    log "✅ Health check OK"
    break
  fi
  warn "Retry $i/6..."
  sleep 5
done

# ─── Quick run test ───
log "Test quick-run (mock repo LogiTrack)..."
RUN_RESPONSE=$(curl -sf -X POST "$PROD_URL/api/v1/projects/quick-run" \
  -H "content-type: application/json" \
  -d '{"repo_url":"https://github.com/Fairuza050894/LogiTrack"}') || {
  warn "Quick-run gagal. Cek logs di Vercel dashboard."
  exit 0
}

RUN_ID=$(echo "$RUN_RESPONSE" | grep -o '"run_id":"[^"]*"' | cut -d'"' -f4)
STREAM_URL=$(echo "$RUN_RESPONSE" | grep -o '"stream":"[^"]*"' | cut -d'"' -f4)
REPORT_URL=$(echo "$RUN_RESPONSE" | grep -o '"report":"[^"]*"' | cut -d'"' -f4)

log "✅ Quick-run created:"
echo "   Run ID:    $RUN_ID"
echo "   Stream:    $PROD_URL$STREAM_URL"
echo "   Report:    $PROD_URL$REPORT_URL"
echo ""
log "Buka dashboard: $PROD_URL/runs/$RUN_ID"
log "Buka laporan:   $PROD_URL$REPORT_URL"
echo ""
log "🎉 Deploy selesai! Veriflow live di $PROD_URL"
echo ""
log "Next steps:"
echo "  1. Install GitHub App ke repo target (Settings → GitHub Apps)"
echo "  2. Set GitHub Actions secret RUNNER_CALLBACK_SECRET (sama dengan Vercel)"
echo "  3. Test webhook: push ke repo terinstall → cek Actions tab"
echo "  4. (Optional) Enable real LLM: vercel env add LLM_PROVIDER production <<<openai"