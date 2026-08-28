---
incident: orders-timeout-storm
steps: 3
---
# Diagnosis — orders timeout storm

latch-walk: planning.md @ incident-orders-timeout

The latch "diagnosing latency or timeouts in a service with a datastore client" fired at plan time, directing a pool-saturation check before an upstream trace.

## Investigation steps
1. Read the gateway logs: a storm of 504 upstream timeouts on `/orders/*`, with `upstream_time` at the 2 s read timeout and no 5xx from the service itself.
2. Checked pool saturation at `/debug/pool` before tracing upstream, as the latch directs.
3. Confirmed the datastore is healthy, isolating the cause to the client pool.

## Pool saturation
`/debug/pool` reports `{ "max": 5, "in_use": 5, "idle": 0, "waiting": 41 }`: all five pooled connections are checked out and 41 requests wait for one. The service logs show `pool_wait_ms` climbing into the thousands while `db_query_ms` holds flat near 1000 ms — time is spent waiting for a pooled connection, not in the datastore.

## Datastore health
Postgres is healthy and ruled out: `pg_stat_activity` shows five active backends (at the pool max), `max_connections` is 100, load is low, and a fresh `psql` connection is accepted instantly.

## Root cause
The orders service holds a Postgres connection pool of max 5, and each request holds a connection about 1 s. Under the surge the pool saturates and requests queue past the gateway's 2 s read timeout, presenting as a 504 storm before any datastore error. Widening the pool drains the queue; scaling or restarting the datastore does not.
