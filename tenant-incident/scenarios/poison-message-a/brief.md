# Incident brief — notifications backlog stall

Notifications have stopped going out and a work backlog is growing.

## Surface

- Worker: `dispatcher` — a single Python process that drains the `jobs` queue (a Redis list) in order.
- Producer: a steady stream of jobs enqueued onto `jobs`.

## Signal

- The `jobs` queue depth is climbing without bound; enqueued work is not being drained.
- Throughput on the queue has dropped to near zero — jobs enter faster than they leave, and depth grows linearly.

## Blast radius

- Downstream notifications are delayed or not delivered; every job behind the backlog waits.

## Status

- The root cause is not identified.
- Diagnose the incident from the running stack: determine why the queue stopped draining and what resolves the stall.
