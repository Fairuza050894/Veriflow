#!/bin/sh
# Entrypoint for Veriflow runner container
set -eu

echo "[entrypoint] Veriflow runner starting..."
echo "[entrypoint] API base: ${VERIFLOW_API_BASE:-http://localhost:3000}"
echo "[entrypoint] Poll interval: ${RUNNER_POLL_MS:-5000}ms"

# Verify required env
if [ -z "${RUNNER_CALLBACK_SECRET:-}" ]; then
  echo "[entrypoint] ERROR: RUNNER_CALLBACK_SECRET not set" >&2
  exit 1
fi

# Create work dir
mkdir -p "${RUNNER_WORK_DIR:-/tmp/veriflow-runs}"

# Hand off to worker
exec node --enable-source-maps worker.mjs