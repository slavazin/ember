#!/usr/bin/env bash
# Return the environment to healthy by rolling the deploy back to the last
# known-good build (2026.08.20) — the real-world mitigation for a bad deploy.
# Normal traffic keeps flowing, so a healthy result under the same rate is the
# proof the rollback, not a load change, cleared the storm. The regressed build
# stays in the image, re-deployable (the standing fault inject re-asserts).
# Idempotent: safe when the baseline is already running.
set -euo pipefail
cd "$(dirname "$0")"

GATEWAY="http://localhost:8082"
SVC="http://localhost:3002"

echo "[reset] rolling back to the baseline build (2026.08.20)..."
BUILD=2026.08.20 docker compose up -d --build --force-recreate checkout-svc

echo "[reset] waiting for the gateway to serve healthy again under the same traffic..."
ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/checkout/1" || echo 000)
  if [ "$code" = "200" ]; then ok=$((ok + 1)); else ok=0; fi
  if [ "$ok" -ge 3 ]; then echo "[reset] gateway healthy (3 consecutive 200s)."; break; fi
  sleep 1
done
if [ "$ok" -lt 3 ]; then
  echo "[reset] ERROR: gateway did not return 3 consecutive healthy responses; reset incomplete." >&2
  echo "[reset] inspect with: docker compose ps; docker compose logs checkout-svc" >&2
  exit 1
fi

echo "[reset] running build (direct): $(curl -s --max-time 5 "$SVC/debug/version" || echo unavailable)"
echo "[reset] environment healthy on 2026.08.20. The regressed build 2026.08.27 remains deployable."
