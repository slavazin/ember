---
incident: notifications-backlog-stall
steps: 3
---
# Diagnosis — notifications backlog stall

latch-walk: planning.md @ incident-queue-backlog

The latch "a growing backlog with idle workers" fired at plan time, directing a head-of-queue state check before any capacity read.

## Investigation steps
1. Read the dispatcher logs and `/debug/queue`: depth climbing without bound while the same head message id fails to parse on every pass.
2. Inspected the head-of-line state rather than worker capacity: `head_redelivers` climbing, `head_error` = `deserialize_failed`, and the head does not clear under observation.
3. Quarantined the head message to the dead-letter list in the sandbox: the backlog drained at the same producer rate, confirming the bad message as cause.

## Queue state
`/debug/queue` reports `{ "depth": 512, "head_id": "b3f1a2c8", "head_redelivers": 240, "head_error": "deserialize_failed", "dlq_depth": 0 }`. One malformed message sits at the head; the worker retries it in place under head-of-line ordering and never advances, so every valid message behind it waits. The bad state does not clear under observation — `head_redelivers` only climbs — so it is a stuck poison message, not a transient blip.

## Capacity ruled out
The worker and Redis are healthy and idle: the worker CPU is low (it sleeps between retries rather than doing work), Redis memory and CPU are low, and the producer rate (~2 msg/s) is well under the worker's healthy drain (~10 msg/s). Adding a worker does not help — a second consumer blocks on the same poisoned head. Capacity is not the cause.

## Root cause
A single malformed message at the head of the `jobs` queue fails to deserialize and is retried in place under head-of-line ordering, so the queue backs up without bound while the worker sits idle. Quarantining the head message to the dead-letter list lets the head advance and the backlog drains; adding workers or Redis capacity does not.
