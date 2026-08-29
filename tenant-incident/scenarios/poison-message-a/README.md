# poison-message-a — notifications backlog stall (Python · Redis queue)

## What it models

The `dispatcher` worker (Python) drains a Redis list queue (`jobs`) in strict
FIFO order: it peeks the head, parses it as a job, does a little work, and pops
it. A steady producer enqueues valid jobs at a modest rate the single worker
drains easily. When one **malformed** message lands at the head, the worker
retries it in place under head-of-line ordering and never advances — there is no
poison handling — so the queue backs up without bound while the worker sits idle
between retries, and every valid message behind the poison waits.

This is the **state**-class failure: the cause is bad persisted state (one poison
message), found by reading the head-of-queue state — `head_redelivers` climbing
while the head does not clear under observation is a stuck bad-state, not a
transient blip — not by reading a resource for capacity.

Its decoy is **saturation**: a growing backlog reads as "the worker can't keep
up," and a naive read reaches for more workers or a bigger broker. But the worker
is CPU-idle (it sleeps between retries), Redis is healthy and low-load, the
producer rate is unchanged and well under a single worker's drain, and a second
worker only blocks on the same poisoned head. The fix is to quarantine the head
message; adding capacity does nothing. A second surface of this class
(`poison-message-b`, a consumer wedge) is a later step.

## The surface

- **Broker:** Redis 7 — ample and healthy; never the ceiling.
- **Worker:** `dispatcher-svc` — single Python process, one ordered consumer of
  `jobs`, `WORK_MS=100` on the happy path, head-of-line retry with no
  dead-lettering (the standing fault). Host port `9101` (direct access to
  `/debug/queue`).
- **Producer:** steady ~2 jobs/s onto the tail of `jobs` — the normal workload,
  always on, held constant so the stall is attributable to the head, not to load.
- **Dead-letter list:** `jobs:dlq` — empty until a message is quarantined.

## Run

```bash
./inject.sh                          # bring up the stack, then place one poison message at the head → the backlog stalls
curl -s localhost:9101/debug/queue   # the smoking gun: {"depth":N,"head_id":"…","head_redelivers":M,"head_error":"deserialize_failed","dlq_depth":0}
docker compose logs dispatcher-svc   # the same msg_id failing to parse every pass; worker idle between retries
docker compose exec redis redis-cli LLEN jobs   # the growing backlog, straight from the broker
./reset.sh                           # quarantine the poison head to jobs:dlq → the backlog drains at the same rate
./grade.sh path/to/diagnosis.md      # score a diagnosis report (defaults to fixtures/diagnosis-good.md)
docker compose down -v               # tear down
```

## The mechanism, as drain vs. block

- Healthy drain = 1 worker ÷ `WORK_MS` = 1 ÷ 0.1 s = **~10 jobs/s**.
- Producer rate = **~2 jobs/s** < 10, so the backlog is near zero while healthy.
- A malformed head is **retried in place, never popped**: the head-of-line drain
  rate for everything behind it drops to **0**, while the producer keeps adding
  at 2 jobs/s, so depth grows linearly and unbounded.
- More workers do not drain it: a second consumer reads the same head and blocks
  on the same parse failure. Scaling Redis does not drain it: the broker is idle.
- Quarantining the poison head to `jobs:dlq` lets the head advance; the single
  worker then drains the accumulated backlog at ~10 jobs/s, back under the
  producer's 2 jobs/s.

A diagnosis resolves this stall only by reading the head state and quarantining
the bad message; no capacity action drains the queue.

## What grade.sh checks — and what it does not

`grade.sh` scores a diagnosis report by presence and step count. It is a floor,
not a judge.

It checks:
- **step count** — authoritative from a `steps:` frontmatter integer, otherwise
  counted from ordered-list items outside code fences (the method used is
  printed);
- a **bad-state section** (the required gate) — a heading naming the
  queue/message/state with a poison/head-of-line token (poison, deserialize,
  redeliver, quarantine, "does not advance") inside it;
- a **capacity-ruled-out line** — the worker/Redis/scaling named as healthy,
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
- `reset.sh` performs the real-world mitigation (quarantine to the DLQ), so here
  reset and the fix coincide. The worker's missing poison handling stays intact —
  the standing fault `inject.sh` re-asserts.
- Scenario prose follows [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) by
  discipline; the corpus banned-tell lint does not yet range over `scenarios/`.
- The stack runs under `docker compose` locally. Provisioning it into a Daytona
  sandbox is a later step and presumes the sandbox runs `docker compose`.
