#!/usr/bin/env bash
# Trigger the incident: start the open-loop load surge against the gateway.
# The small pool (max 5) is the standing latent misconfiguration; the surge
# surfaces it as a gateway timeout storm. Idempotent: re-running re-asserts the
# same state.
set -euo pipefail
cd "$(dirname "$0")"

GATEWAY="http://localhost:8080"
SVC="http://localhost:3001"

echo "[inject] ensuring the core stack is up (gateway + orders-svc + postgres)..."
docker compose up -d --build postgres orders-svc gateway

echo "[inject] waiting for the gateway to serve a healthy request..."
ready=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/orders/1" || echo 000)
  if [ "$code" = "200" ]; then echo "[inject] gateway healthy (200)."; ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[inject] ERROR: gateway did not become healthy within 30s; not starting the surge." >&2
  echo "[inject] inspect with: docker compose ps; docker compose logs" >&2
  exit 1
fi

echo "[inject] starting the load surge (open-loop ~8 req/s)..."
docker compose --profile inject up -d --build loadgen

echo "[inject] letting the storm set in..."
sleep 8

storm=0; ok=0; other=0
for _ in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$GATEWAY/orders/1" || echo 000)
  case "$code" in
    504) storm=$((storm + 1)) ;;
    200) ok=$((ok + 1)) ;;
    *)   other=$((other + 1)) ;;
  esac
done

echo "[inject] gateway sample over 10 probes: 504=${storm} 200=${ok} other=${other}"
echo "[inject] pool stats (direct): $(curl -s --max-time 5 "$SVC/debug/pool" || echo unavailable)"
echo "[inject] incident is live. Investigate via the gateway ($GATEWAY) and orders-svc ($SVC)."
echo "[inject]   docker compose logs gateway     # the 504 storm"
echo "[inject]   docker compose logs orders-svc  # pool_wait_ms climbing; db_query_ms flat; no datastore error"
