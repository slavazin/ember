#!/usr/bin/env bash
# Trigger the incident: with steady normal traffic already flowing, deploy the
# regressed build. The build change is the whole incident; the traffic rate is
# held constant across the deploy, so the storm cannot be blamed on load.
# Idempotent: re-running re-asserts the regressed build and the same traffic.
set -euo pipefail
cd "$(dirname "$0")"

GATEWAY="http://localhost:8082"
SVC="http://localhost:3002"

echo "[inject] bringing up the baseline build (2026.08.20) + gateway..."
BUILD=2026.08.20 docker compose up -d --build checkout-svc gateway

echo "[inject] waiting for the gateway to serve a healthy request..."
ready=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/checkout/1" || echo 000)
  if [ "$code" = "200" ]; then echo "[inject] gateway healthy (200) on baseline."; ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[inject] ERROR: gateway did not become healthy within 30s; aborting." >&2
  echo "[inject] inspect with: docker compose ps; docker compose logs" >&2
  exit 1
fi

echo "[inject] starting steady normal traffic (~5 req/s)..."
docker compose --profile inject up -d --build loadgen
sleep 4

echo "[inject] deploying the regressed build (2026.08.27) under the same traffic..."
BUILD=2026.08.27 docker compose up -d --build --force-recreate checkout-svc

echo "[inject] letting the storm set in..."
sleep 10

storm=0; ok=0; other=0
for _ in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$GATEWAY/checkout/1" || echo 000)
  case "$code" in
    504) storm=$((storm + 1)) ;;
    200) ok=$((ok + 1)) ;;
    *)   other=$((other + 1)) ;;
  esac
done

echo "[inject] gateway sample over 10 probes: 504=${storm} 200=${ok} other=${other}"
echo "[inject] running build (direct): $(curl -s --max-time 5 "$SVC/debug/version" || echo unavailable)"
echo "[inject] incident is live. Investigate via the gateway ($GATEWAY) and checkout-svc ($SVC)."
echo "[inject]   curl -s $SVC/debug/version    # build 2026.08.27, previous 2026.08.20, started_at = onset"
echo "[inject]   curl -s $SVC/debug/deploys    # the deploy history, latest deploy at the onset"
echo "[inject]   docker compose logs gateway   # the 504 storm, upstream_time at the 2 s timeout"
echo "[inject]   docker compose logs checkout-svc  # handler_ms ~2500 with audit_ms ~2500; time is in the service"
