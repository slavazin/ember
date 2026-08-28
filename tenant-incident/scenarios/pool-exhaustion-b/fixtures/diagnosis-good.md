---
incident: catalog-timeout-storm
steps: 3
---
# Diagnosis — catalog timeout storm

latch-walk: planning.md @ incident-catalog-timeout

The latch "diagnosing latency or timeouts in a service with a datastore client" fired at plan time, directing a pool-saturation check before an upstream trace.

## Investigation steps
1. Read the gateway logs: a storm of 504 upstream timeouts on `/catalog/*`, with `upstream_time` at the 2 s read timeout and no 5xx from the service itself.
2. Checked pool saturation at `/debug/pool` before tracing upstream, as the latch directs.
3. Confirmed the datastore is healthy, isolating the cause to the client pool.

## Pool saturation
`/debug/pool` reports `{ "max": 5, "in_use": 5, "waiting": 38 }`: all five pooled connections are in use and 38 requests wait for one. The service logs show `pool_wait_ms` climbing into the thousands while `redis_op_ms` holds flat near 1000 ms — time is spent waiting for a pooled connection, not in the datastore.

## Datastore health
Redis is healthy and ruled out: `INFO clients` shows few connected clients and a high `blocked_clients` count (the pooled connections parked in a blocking read), `INFO stats` shows low load, and `PING` returns instantly.

## Root cause
The catalog service holds a Redis connection pool of max 5, and each request holds a connection about 1 s in a blocking read. Under the surge the pool exhausts and requests queue past the gateway's 2 s read timeout, presenting as a 504 storm before any datastore error. Widening the pool drains the queue; scaling or restarting the datastore does not.
