# scenarios/ — incident scenarios (local-first)

Containerized, resettable failure scenarios the incident responder diagnoses.
Each runs under `docker compose` alone, with three scripts:

- `inject.sh` — trigger the failure;
- `reset.sh` — return the environment to healthy;
- `grade.sh` — score a diagnosis report (the demo metric).

No harness dependency: the scenarios stand up with `docker compose` on one
machine. Provisioning them into a Daytona sandbox is a later step and presumes
the sandbox runs `docker compose`.

## The battery — classes across recon shapes

The suite spans failure *classes* chosen so each is found by a different
investigation shape (the recon lenses in the `investigate` skill), and each
carries a louder **decoy** shape a naive read reaches for first. A corpus only
learns the shapes its incidents present, so the battery is grown shape-first.

| Scenario | Class | Dominant shape | Decoy | Surface |
|---|---|---|---|---|
| [pool-exhaustion-a](/tenant-incident/scenarios/pool-exhaustion-a) | pool-exhaustion | saturation | dependency | orders · Node · PostgreSQL |
| [pool-exhaustion-b](/tenant-incident/scenarios/pool-exhaustion-b) | pool-exhaustion | saturation | dependency | catalog · Python · Redis |
| [bad-deploy-a](/tenant-incident/scenarios/bad-deploy-a) | bad-deploy | change | saturation | checkout · Node · latency regression → 504 storm |
| [bad-deploy-b](/tenant-incident/scenarios/bad-deploy-b) | bad-deploy | change | bad-data | pricing · Python · error-rate regression → 500 spike |
| [poison-message-a](/tenant-incident/scenarios/poison-message-a) | poison-message | state | saturation | notifications · Python · Redis-list head |
| [poison-message-b](/tenant-incident/scenarios/poison-message-b) | poison-message | state | saturation | jobs · Node · Postgres-table consumer wedge |

Three classes across three dominant shapes (**saturation**, **change**,
**state**), each with two distinct surfaces (`a`/`b`) — the surface-distinctness
a rule bar reads. Within a class the two surfaces differ in language, framework,
and datastore/broker (and, for `bad-deploy`, in decoy and presentation) while
sharing the dominant shape, so a duty generalized from both carries a warrant two
distinct surfaces earned. All six share the presentation-keyed naming and the
presence-floor grader described below.

## The recurrence pair (one failure class, two surfaces)

Both scenarios reproduce one class: a bounded datastore-client connection pool
saturates under a load surge and presents as a gateway timeout storm before any
datastore error, with the cause visible only in pool-saturation metrics.

| Scenario | Service | Stack | Datastore | Pool |
|---|---|---|---|---|
| [pool-exhaustion-a](/tenant-incident/scenarios/pool-exhaustion-a) | orders | Node.js · Express | PostgreSQL | `pg.Pool` max 5 |
| [pool-exhaustion-b](/tenant-incident/scenarios/pool-exhaustion-b) | catalog | Python · FastAPI | Redis | `BlockingConnectionPool` max 5 |

The two differ in language, framework, datastore family, and pool library, and
share the saturation mechanism. On surface A a Postgres `pg_sleep` occupies the
pooled connection; on surface B a Redis `BRPOP` does. The pair is the recurrence
the learning delta is measured on: a duty generalized from both surfaces carries
a warrant two distinct surfaces earned, not one surface renamed.

## Shared conventions

- **Load model — open-loop, fixed arrival rate about 8 req/s.** Drain rate =
  pool max ÷ per-request hold = 5 ÷ 1 s = 5 req/s, so an arrival rate of 8
  exceeds the drain and the storm sets in. Doubling the pool to 10 (drain 10 > 8)
  drains the queue; scaling the datastore does not. An open-loop rate is
  deliberate: a closed-loop generator that re-fires on each response would
  couple the offered rate to the failure and hide whether widening the pool
  drains the queue.
- **Single process per service.** Each service runs one process and one pool, so
  widening the pool is the only lever; horizontal scaling would add a second
  pool and mask the cause.
- **Grader — presence and step count, a floor, not a judge.** Each scenario's
  README states exactly what its `grade.sh` does and does not verify. The step
  count is the demo metric: an incident where the pool is checked late scores a
  high count; a later incident of this class where the pool is checked early
  scores a fraction of it.
- **Naming.** The directory name carries the class label; every in-scenario
  identifier — service, container, log line — is keyed on how the incident
  presents (a timeout storm on `orders` or `catalog`), so a responder
  investigating the running stack is not handed the conclusion.

## Ground truth

Each scenario carries the evidence a diagnosis needs — gateway logs with the 504
storm, service logs separating pool-wait time from datastore time, a
`/debug/pool` endpoint, an inspectable pool configuration, and a healthy
datastore — and no path resolves the storm without checking pool saturation.
