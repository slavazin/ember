# pool-exhaustion-b — catalog timeout storm (Python · Redis)

## What it models

The `catalog` service (Python/FastAPI) holds a client-side connection pool of
max 5 to a healthy Redis. Each request checks out a pooled connection and holds
it about 1 s in a blocking read (`BRPOP` on a normally-empty list). An nginx
gateway fronts the service with a 2 s upstream read timeout.

An open-loop load surge of about 8 requests per second exceeds what the pool
drains (5 connections ÷ 1 s hold = 5 requests per second), so requests queue for
a free connection. The wait crosses the gateway's 2 s timeout and the gateway
returns a storm of 504s — while Redis stays healthy and emits no error, because
`BRPOP` parks blocked clients server-side without loading single-threaded Redis.
The cause is visible only in pool-saturation metrics.

This is the same failure class as [/tenant-incident/scenarios/pool-exhaustion-a](/tenant-incident/scenarios/pool-exhaustion-a)
(Node · PostgreSQL) on a different surface: a different language, framework,
datastore family, and pool library, saturating by the same mechanism. `BRPOP`
here plays the role `pg_sleep` plays there — a datastore operation that occupies
the pooled connection about 1 s while the datastore stays able to serve others.

## The surface

- **Gateway:** nginx — `proxy_read_timeout 2s`, single upstream,
  `proxy_next_upstream off`. Host port `8081`.
- **Service:** `catalog-svc` — Python/FastAPI, `redis-py`
  `BlockingConnectionPool(max_connections=5)`, single uvicorn worker. Host port
  `8001` (direct access to `/debug/pool`).
- **Datastore:** Redis 7.
- **Load:** `loadgen` — open-loop about 8 req/s, per-request timeout 10 s. Off
  until `inject.sh` starts it.

`BlockingConnectionPool` is deliberate: it blocks when the pool is exhausted, so
saturation presents as waiting and then a gateway 504. The default pool would
raise "Too many connections" immediately, which would name the cause instead of
presenting as a timeout storm.

## Run

```bash
./inject.sh                          # bring up the stack, then start the surge → the 504 storm goes live
curl -s localhost:8001/debug/pool    # the smoking gun: {"max":5,"in_use":5,"waiting":N}
docker compose logs gateway          # the 504 storm, with upstream_time at the 2 s timeout
docker compose logs catalog-svc      # pool_wait_ms climbing; redis_op_ms flat near 1000; no datastore error
./reset.sh                           # stop the surge, restart the service → healthy again
./grade.sh path/to/diagnosis.md      # score a diagnosis report (defaults to fixtures/diagnosis-good.md)
docker compose down -v               # tear down
```

## The mechanism, as arithmetic

- Drain rate = pool max ÷ per-request hold = 5 ÷ 1 s = **5 req/s**.
- Surge arrival rate = **8 req/s** > 5, so the queue grows and the storm sets in.
- Doubling the pool to 10 raises the drain to 10 req/s > 8, so the queue
  **drains**; raising the pool to 8 or more clears the storm outright.
- Scaling or restarting the datastore does not drain the queue: Redis is healthy
  and idle, and the ceiling is the client pool.
- The service runs as a single worker, so adding pooled connections is the only
  lever. More workers would add a second pool and mask the cause, so it is out
  of scope for this scenario.

A diagnosis resolves this storm only by checking pool saturation; no
datastore-side action fixes it.

## What grade.sh checks — and what it does not

`grade.sh` scores a diagnosis report by presence and step count. It is a floor,
not a judge.

It checks:
- **step count** — authoritative from a `steps:` frontmatter integer, otherwise
  counted from ordered-list items outside code fences (the method used is
  printed);
- a **pool-metrics section** — a heading naming the pool plus a saturation token
  within that section;
- a **datastore-ruled-out line** — the datastore named as healthy or excluded;
- a **latch-walk attestation** — a `latch-walk:` line or a "Latch walk" heading.

It does not check:
- that any number in the report is correct;
- that the diagnosis is right or that the named fix would work;
- that a matched section carries meaningful content — a heading with the right
  words passes, which is presence, not correctness;
- that the step count reflects real work rather than padding.

The step count is the demo metric: an incident where the pool is checked late
scores a high count; a later incident of this class where the pool is checked
early scores a fraction of it. `fixtures/diagnosis-good.md` passes every gate at
3 steps; `fixtures/diagnosis-sparse.md` fails the pool-metrics gate at 9 steps —
the two show the gates discriminate.

## Limits

- The latch-walk gate presumes a responder that records a latch-walk line; a
  correct pool diagnosis from another producer fails only that gate. The
  canonical attestation format lives in [/corpus/latches/README.md](/corpus/latches/README.md),
  and this grep tracks it.
- Scenario prose follows [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) by
  discipline; the corpus banned-tell lint does not yet range over `scenarios/`.
- The stack runs under `docker compose` locally. Provisioning it into a Daytona
  sandbox is a later step and presumes the sandbox runs `docker compose`.
