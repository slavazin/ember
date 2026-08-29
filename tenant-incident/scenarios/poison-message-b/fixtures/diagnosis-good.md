---
incident: jobs-queue-consumer-wedge
steps: 3
---
# Diagnosis — jobs queue consumer wedge

latch-walk: planning.md @ incident-queue-backlog

The latch "a growing backlog with idle workers" fired at plan time, directing a head-of-queue state check before any capacity read.

## Investigation steps
1. Read the worker logs and `/debug/queue`: pending climbing without bound while the same `row_id` fails validation on every pass.
2. Inspected the head-of-line row state rather than worker capacity: `head_id` = 1, `head_redelivers` climbing, `head_error` = `validation_failed`, and the head does not clear under observation.
3. Quarantined the head row to `status='dead'` in the sandbox: the backlog drained at the same producer rate, confirming the bad row as cause.

## Queue state
`/debug/queue` reports `{ "pending": 480, "head_id": 1, "head_redelivers": 230, "head_error": "validation_failed", "dead": 0 }`. One invalid row (id 1, empty payload, missing `to`) sits at the head; the worker re-selects it in id order under head-of-line ordering and never advances, so every valid row behind it waits. The bad state does not clear under observation — `head_redelivers` only climbs — so it is a stuck poison row, not a transient blip.

## Capacity ruled out
The worker and Postgres are healthy and idle: the worker CPU is low (it sleeps between retries rather than doing work), Postgres load is low, and the producer rate (~2 rows/s) is well under the worker's healthy drain (~10 rows/s). Adding a worker does not help — a second consumer wedges on the same head row. Capacity is not the cause.

## Root cause
A single invalid row at the head of the `jobs` table fails validation and is retried in place under strict id ordering, so the pending backlog grows without bound while the worker sits idle. Quarantining the head row (marking it `dead`) lets the head advance and the backlog drains; adding workers or Postgres capacity does not.
