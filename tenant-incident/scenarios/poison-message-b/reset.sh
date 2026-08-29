#!/usr/bin/env bash
# Return the environment to healthy by quarantining the poison row — marking it
# 'dead' so it leaves the pending set. The head advances, the worker drains the
# backlog at the unchanged producer rate, and pending returns to a low steady
# state. The worker's missing poison handling stays intact (the standing fault
# inject re-asserts). Idempotent: safe when no poison row is present.
set -euo pipefail
cd "$(dirname "$0")"

DISP="http://localhost:9102"

echo "[reset] quarantining the poison row (id 1 -> status 'dead')..."
docker compose exec -T postgres psql -U app -d jobs -v ON_ERROR_STOP=1 -c \
  "UPDATE jobs SET status='dead' WHERE id=1;" >/dev/null

echo "[reset] waiting for the backlog to drain to a low steady state..."
low=0
for _ in $(seq 1 40); do
  pending=$(curl -s --max-time 5 "$DISP/debug/queue" | grep -oE '"pending":[0-9]+' | grep -oE '[0-9]+' || echo 999)
  pending="${pending:-999}"
  if [ "$pending" -le 5 ]; then low=$((low + 1)); else low=0; fi
  if [ "$low" -ge 3 ]; then echo "[reset] backlog drained (pending <= 5 for 3 consecutive samples)."; break; fi
  sleep 1
done
if [ "$low" -lt 3 ]; then
  echo "[reset] ERROR: backlog did not drain to a low steady state; reset incomplete." >&2
  echo "[reset] inspect with: curl -s $DISP/debug/queue; docker compose logs worker-svc" >&2
  exit 1
fi

echo "[reset] queue stats (direct): $(curl -s --max-time 5 "$DISP/debug/queue" || echo unavailable)"
echo "[reset] environment healthy. The worker's missing poison handling remains (the standing fault)."
