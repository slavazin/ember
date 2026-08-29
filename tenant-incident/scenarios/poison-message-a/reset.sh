#!/usr/bin/env bash
# Return the environment to healthy by quarantining the poison message to the
# dead-letter list — the real-world mitigation. The head advances, the worker
# drains the backlog at the unchanged producer rate, and depth returns to a low
# steady state. The worker's missing poison handling stays intact (the standing
# fault inject re-asserts). Idempotent: safe when no poison is present.
set -euo pipefail
cd "$(dirname "$0")"

DISP="http://localhost:9101"
POISON='POISON'

echo "[reset] quarantining the poison head to the dead-letter list..."
docker compose exec -T redis redis-cli LREM jobs 0 "$POISON" >/dev/null || true
docker compose exec -T redis redis-cli RPUSH jobs:dlq "$POISON" >/dev/null || true

echo "[reset] waiting for the backlog to drain to a low steady state..."
low=0
for _ in $(seq 1 40); do
  depth=$(curl -s --max-time 5 "$DISP/debug/queue" | grep -oE '"depth":[0-9]+' | grep -oE '[0-9]+' || echo 999)
  depth="${depth:-999}"
  if [ "$depth" -le 5 ]; then low=$((low + 1)); else low=0; fi
  if [ "$low" -ge 3 ]; then echo "[reset] backlog drained (depth <= 5 for 3 consecutive samples)."; break; fi
  sleep 1
done
if [ "$low" -lt 3 ]; then
  echo "[reset] ERROR: backlog did not drain to a low steady state; reset incomplete." >&2
  echo "[reset] inspect with: curl -s $DISP/debug/queue; docker compose logs dispatcher-svc" >&2
  exit 1
fi

echo "[reset] queue stats (direct): $(curl -s --max-time 5 "$DISP/debug/queue" || echo unavailable)"
echo "[reset] environment healthy. The worker's missing poison handling remains (the standing fault)."
