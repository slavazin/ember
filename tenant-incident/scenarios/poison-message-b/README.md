# poison-message-b — jobs queue consumer wedge (Node · Postgres table queue)

## What it models

The `dispatcher` worker (Node.js) drains a Postgres-table work queue (`jobs`) in
strict id order: it selects the lowest-id `pending` row, validates it, does a
little work, and marks it `done`. A steady producer inserts valid pending rows
(ids ≥ 1001) at a modest rate the single worker drains easily. When one
**invalid** row sits at the head (id 1, below the producer's range), the worker
re-selects and re-fails it every pass and never advances — there is no
dead-lettering — so the pending backlog grows without bound while the worker sits
idle between retries.

This is the **state**-class failure, the same class as
[poison-message-a](/tenant-incident/scenarios/poison-message-a) on a distinct
surface: a different language and broker (Node over a Postgres table, not Python
over a Redis list) and a different mechanism (an ordered consumer wedged on an
invalid persisted row, not a malformed message at a list head). The shared lesson
is the class's: read the head-of-queue state — `head_redelivers` climbing while
the head does not clear is a stuck bad-state — before reaching for capacity. A
duty generalized from both surfaces carries a warrant two distinct surfaces
earned.

Its decoy is **saturation**: a growing backlog reads as "the consumer can't keep
up," and a naive read reaches for more workers or a bigger database. But the
worker is CPU-idle, Postgres is healthy and low-load, the producer rate is
unchanged and well under a single worker's drain, and a second worker only wedges
on the same head row. The fix is to quarantine the head row; adding capacity does
nothing.

## The surface

- **Datastore:** PostgreSQL 16 — the `jobs` table doubles as the queue; ample and
  healthy, never the ceiling.
- **Worker:** `worker-svc` — single Node.js process, one ordered consumer of
  `jobs`, `WORK_MS=100` on the happy path, head-of-line retry with no
  dead-lettering (the standing fault). Host port `9102` (direct access to
  `/debug/queue`).
- **Producer:** steady ~2 rows/s inserted with ids ≥ 1001 — the normal workload,
  always on, held constant so the stall is attributable to the head, not to load.
- **Quarantine sink:** rows marked `status='dead'` leave the pending set.

## Run

```bash
./inject.sh                          # bring up the stack, then place one invalid row at the head → the backlog stalls
curl -s localhost:9102/debug/queue   # the smoking gun: {"pending":N,"head_id":1,"head_redelivers":M,"head_error":"validation_failed","dead":0}
docker compose logs worker-svc       # the same row_id=1 failing validation every pass; worker idle between retries
docker compose exec postgres psql -U app -d jobs -c "SELECT status, count(*) FROM jobs GROUP BY status;"   # the growing pending backlog
./reset.sh                           # quarantine the head row (status 'dead') → the backlog drains at the same rate
./grade.sh path/to/diagnosis.md      # score a diagnosis report (defaults to fixtures/diagnosis-good.md)
docker compose down -v               # tear down
```

## The mechanism, as drain vs. block

- Healthy drain = 1 worker ÷ `WORK_MS` = 1 ÷ 0.1 s = **~10 rows/s**.
- Producer rate = **~2 rows/s** < 10, so the pending backlog is near zero while
  healthy.
- An invalid head row is **left pending and re-selected, never advanced**: the
  head-of-line drain rate for everything behind it drops to **0**, while the
  producer keeps inserting at 2 rows/s, so pending grows linearly and unbounded.
- More workers do not drain it: a second consumer selects the same lowest-id
  pending row and wedges on the same validation failure. Scaling Postgres does
  not drain it: the datastore is idle.
- Quarantining the head row (`status='dead'`) lets the head advance; the single
  worker then drains the accumulated backlog at ~10 rows/s, back under the
  producer's 2 rows/s.

A diagnosis resolves this stall only by reading the head state and quarantining
the bad row; no capacity action drains the queue.

## What grade.sh checks — and what it does not

`grade.sh` scores a diagnosis report by presence and step count. It is a floor,
not a judge. It uses the same gates as poison-message-a (same class, same decoy).

It checks:
- **step count** — authoritative from a `steps:` frontmatter integer, otherwise
  counted from ordered-list items outside code fences (the method used is
  printed);
- a **bad-state section** (the required gate) — a heading naming the
  queue/message/state/row with a poison/head-of-line token (poison, invalid,
  validation, redeliver, quarantine, "does not advance") inside it;
- a **capacity-ruled-out line** — the worker/Postgres/scaling named as healthy,
  idle, or excluded;
- a **latch-walk attestation** — a `latch-walk:` line or a "Latch walk" heading.

It does not check:
- that any number in the report is correct;
- that the diagnosis is right or that the named quarantine would work;
- that a matched section carries meaningful content — a heading with the right
  words passes, which is presence, not correctness;
- that the step count reflects real work rather than padding.

The step count is the demo metric: an incident where the head state is read late
(after a scaling detour) scores a high count; a later incident of this class
where the head is read early scores a fraction of it.
`fixtures/diagnosis-good.md` passes every gate at 3 steps;
`fixtures/diagnosis-sparse.md` chases scaling, fails the bad-state gate, and
scores 9 — the two show the gates discriminate.

## Limits

- The latch-walk gate presumes a responder that records a latch-walk line; a
  correct state diagnosis from another producer fails only that gate. The
  canonical attestation format lives in [/corpus/latches/README.md](/corpus/latches/README.md).
- `reset.sh` performs the real-world mitigation (quarantine to `dead`), so here
  reset and the fix coincide. The worker's missing poison handling stays intact —
  the standing fault `inject.sh` re-asserts.
- Scenario prose follows [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) by
  discipline; the corpus banned-tell lint does not yet range over `scenarios/`.
- The stack runs under `docker compose` locally. Provisioning it into a Daytona
  sandbox is a later step and presumes the sandbox runs `docker compose`.
