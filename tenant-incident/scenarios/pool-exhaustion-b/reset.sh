#!/usr/bin/env bash
# Return the environment to healthy: stop the load surge and restart the service
# to drop the queued backlog and any orphaned in-flight handlers, so the gateway
# serves 200 again within a second. The latent small-pool configuration stays
# intact (the standing misconfiguration is realistic and is what a fix widens).
# Idempotent: safe when the surge is already stopped.
set -euo pipefail
cd "$(dirname "$0")"

GATEWAY="http://localhost:8081"
SVC="http://localhost:8001"

echo "[reset] stopping the load surge..."
docker compose --profile inject stop loadgen 2>/dev/null || true
docker compose --profile inject rm -f loadgen 2>/dev/null || true

echo "[reset] restarting catalog-svc to clear the backlog and orphaned handlers..."
docker compose restart catalog-svc

echo "[reset] waiting for the gateway to serve healthy again..."
ok=0
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/catalog/1" || echo 000)
  if [ "$code" = "200" ]; then ok=$((ok + 1)); else ok=0; fi
  if [ "$ok" -ge 3 ]; then echo "[reset] gateway healthy (3 consecutive 200s)."; break; fi
  sleep 1
done

echo "[reset] pool stats (direct): $(curl -s --max-time 5 "$SVC/debug/pool" || echo unavailable)"
echo "[reset] environment healthy. Latent pool max 5 remains (the standing misconfiguration)."
