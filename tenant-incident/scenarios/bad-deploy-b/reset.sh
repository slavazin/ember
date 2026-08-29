#!/usr/bin/env bash
# Return the environment to healthy by rolling the deploy back to the last
# known-good build (2026.09.02) — the real-world mitigation for a bad deploy.
# Traffic keeps flowing across the same cart mix, so a clean result on a
# previously-erroring cart is the proof the rollback, not an input change,
# cleared the errors. The regressed build stays in the image, re-deployable.
# Idempotent: safe when the baseline is already running.
set -euo pipefail
cd "$(dirname "$0")"

GATEWAY="http://localhost:8083"
SVC="http://localhost:3003"

echo "[reset] rolling back to the baseline build (2026.09.02)..."
BUILD=2026.09.02 docker compose up -d --build --force-recreate pricing-svc

# The recreate can hand the backend a new container IP; restart the gateway so
# nginx re-resolves it, otherwise the health check below fails against the dead
# old IP even though the baseline restarted successfully.
echo "[reset] restarting the gateway so it re-resolves the rolled-back backend..."
docker compose restart gateway

echo "[reset] waiting for a previously-erroring cart to serve healthy again..."
ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/price/4" || echo 000)
  if [ "$code" = "200" ]; then ok=$((ok + 1)); else ok=0; fi
  if [ "$ok" -ge 3 ]; then echo "[reset] cart 4 healthy (3 consecutive 200s)."; break; fi
  sleep 1
done
if [ "$ok" -lt 3 ]; then
  echo "[reset] ERROR: cart 4 did not return 3 consecutive healthy responses; reset incomplete." >&2
  echo "[reset] inspect with: docker compose ps; docker compose logs pricing-svc" >&2
  exit 1
fi

echo "[reset] running build (direct): $(curl -s --max-time 5 "$SVC/debug/version" || echo unavailable)"
echo "[reset] environment healthy on 2026.09.02. The regressed build 2026.09.09 remains deployable."
