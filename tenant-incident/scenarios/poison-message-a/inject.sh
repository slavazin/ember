#!/usr/bin/env bash
# Trigger the incident: place a single malformed message at the head of the
# `jobs` queue. The worker retries the head in place and never advances, so the
# backlog grows without bound under the unchanged normal producer rate.
# Idempotent: removes any existing copy first, so exactly one poison sits at the
# head no matter how often this runs.
set -euo pipefail
cd "$(dirname "$0")"

DISP="http://localhost:9101"
POISON='POISON'   # a raw, non-JSON payload the worker cannot deserialize

echo "[inject] bringing up redis + dispatcher-svc + producer (normal workload)..."
docker compose up -d --build redis dispatcher-svc producer

echo "[inject] waiting for the dispatcher to answer /debug/queue..."
ready=0
for _ in $(seq 1 30); do
  if curl -s --max-time 5 "$DISP/debug/queue" | grep -q '"depth"'; then
    echo "[inject] dispatcher healthy."; ready=1; break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[inject] ERROR: dispatcher did not become healthy within 30s; aborting." >&2
  echo "[inject] inspect with: docker compose ps; docker compose logs" >&2
  exit 1
fi

echo "[inject] enqueuing one poison message at the head (idempotent)..."
docker compose exec -T redis redis-cli LREM jobs 0 "$POISON" >/dev/null || true
docker compose exec -T redis redis-cli LPUSH jobs "$POISON" >/dev/null

echo "[inject] letting the backlog build..."
sleep 8

echo "[inject] queue stats (direct): $(curl -s --max-time 5 "$DISP/debug/queue" || echo unavailable)"
echo "[inject] incident is live. Investigate via the dispatcher ($DISP)."
echo "[inject]   curl -s $DISP/debug/queue        # depth climbing; head_redelivers climbing; head_error=deserialize_failed; dlq_depth=0"
echo "[inject]   docker compose logs dispatcher-svc  # the same msg_id failing to parse every pass; worker idle between retries"
echo "[inject]   docker compose exec redis redis-cli LLEN jobs   # the growing backlog, straight from the broker"
