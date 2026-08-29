#!/usr/bin/env bash
# Trigger the incident: with steady traffic across a fixed cart mix already
# flowing, deploy the regressed build. The build change is the whole incident;
# the cart mix is held constant across the deploy, so the error spike cannot be
# blamed on a change of inputs.
# Idempotent: re-running re-asserts the regressed build and the same traffic.
set -euo pipefail
cd "$(dirname "$0")"

GATEWAY="http://localhost:8083"
SVC="http://localhost:3003"

echo "[inject] bringing up the baseline build (2026.09.02) + gateway..."
BUILD=2026.09.02 docker compose up -d --build pricing-svc gateway

echo "[inject] waiting for the gateway to serve a healthy price..."
ready=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/price/4" || echo 000)
  if [ "$code" = "200" ]; then echo "[inject] gateway healthy (200 on cart 4, baseline)."; ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[inject] ERROR: gateway did not become healthy within 30s; aborting." >&2
  echo "[inject] inspect with: docker compose ps; docker compose logs" >&2
  exit 1
fi

echo "[inject] starting steady traffic across carts 1..5 (~5 req/s)..."
docker compose --profile inject up -d --build loadgen
sleep 4

echo "[inject] deploying the regressed build (2026.09.09) under the same cart mix..."
BUILD=2026.09.09 docker compose up -d --build --force-recreate pricing-svc

echo "[inject] letting the error rate set in..."
sleep 8

# Cart 1 carries a discount (always 200); cart 4 carries none (500 on the
# regressed build). Sampling both shows the split.
ok=0; err=0
for _ in $(seq 1 10); do
  c1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$GATEWAY/price/1" || echo 000)
  c4=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$GATEWAY/price/4" || echo 000)
  [ "$c1" = "200" ] && ok=$((ok + 1))
  [ "$c4" = "500" ] && err=$((err + 1))
done

echo "[inject] sample over 10 pairs: cart1=200 x${ok}/10   cart4=500 x${err}/10"
echo "[inject] running build (direct): $(curl -s --max-time 5 "$SVC/debug/version" || echo unavailable)"
echo "[inject] incident is live. Investigate via the gateway ($GATEWAY) and pricing-svc ($SVC)."
echo "[inject]   curl -s $SVC/debug/version    # build 2026.09.09, previous 2026.09.02, started_at = onset"
echo "[inject]   curl -s $SVC/debug/deploys    # the deploy history, latest deploy at the onset"
echo "[inject]   docker compose logs gateway   # a mix of status=200 and status=500 on /price/*"
echo "[inject]   docker compose logs pricing-svc  # KeyError on 'discount' for carts 4 and 5 — the error is in the handler"
