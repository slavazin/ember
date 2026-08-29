#!/usr/bin/env bash
# Trigger the incident: place a single invalid row at the head of the `jobs`
# table (id 1, below the producer's id range, so it is always the lowest pending
# id). The worker re-selects and re-fails it every pass and never advances, so
# the backlog grows without bound under the unchanged normal producer rate.
# Idempotent: upserts exactly one poison row at id 1 no matter how often it runs.
set -euo pipefail
cd "$(dirname "$0")"

DISP="http://localhost:9102"

echo "[inject] bringing up postgres + worker-svc + producer (normal workload)..."
docker compose up -d --build postgres worker-svc producer

echo "[inject] waiting for the worker to answer /debug/queue..."
ready=0
for _ in $(seq 1 30); do
  if curl -s --max-time 5 "$DISP/debug/queue" | grep -q '"pending"'; then
    echo "[inject] worker healthy."; ready=1; break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[inject] ERROR: worker did not become healthy within 30s; aborting." >&2
  echo "[inject] inspect with: docker compose ps; docker compose logs" >&2
  exit 1
fi

echo "[inject] inserting one poison row at the head (id 1, invalid payload)..."
docker compose exec -T postgres psql -U app -d jobs -v ON_ERROR_STOP=1 -c \
  "INSERT INTO jobs (id, kind, payload, status) VALUES (1, 'email', '{}'::jsonb, 'pending')
   ON CONFLICT (id) DO UPDATE SET kind='email', payload='{}'::jsonb, status='pending';" >/dev/null

echo "[inject] letting the backlog build..."
sleep 8

echo "[inject] queue stats (direct): $(curl -s --max-time 5 "$DISP/debug/queue" || echo unavailable)"
echo "[inject] incident is live. Investigate via the worker ($DISP)."
echo "[inject]   curl -s $DISP/debug/queue        # pending climbing; head_id=1; head_redelivers climbing; head_error=validation_failed; dead=0"
echo "[inject]   docker compose logs worker-svc   # the same row_id=1 failing validation every pass; worker idle between retries"
echo "[inject]   docker compose exec postgres psql -U app -d jobs -c \"SELECT status, count(*) FROM jobs GROUP BY status;\"   # the growing pending backlog"
