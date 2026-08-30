# Incident brief — jobs backlog stall

A job backlog is growing and work has stopped completing.

## Surface

- Worker: `worker` — a single Node.js process that drains the `jobs` Postgres table in id order, marking rows done.
- Producer: a steady stream of new pending rows inserted into `jobs`.

## Signal

- The count of `pending` rows in `jobs` is climbing without bound; pending work is not being marked done.
- Throughput has dropped to near zero — rows are inserted faster than they are completed, and the pending count grows linearly.

## Blast radius

- Queued jobs are not being processed; every pending row waits behind the backlog.

## Status

- The root cause is not identified.
- Diagnose the incident from the running stack: determine why the worker stopped completing rows and what resolves the stall.
