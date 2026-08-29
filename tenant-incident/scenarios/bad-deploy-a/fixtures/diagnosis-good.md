---
incident: checkout-timeout-storm
steps: 3
---
# Diagnosis — checkout timeout storm

latch-walk: planning.md @ incident-checkout-timeout

The latch "a timeout storm with no traffic change" fired at plan time, directing a deploy/change correlation before any capacity read.

## Investigation steps
1. Read the gateway logs: a storm of 504s on `/checkout/*`, `upstream_time` pinned at the 2 s read timeout, onset at 14:02.
2. Correlated the onset with the deploy history rather than reading for saturation: `/debug/version` reports build `2026.08.27` (previous `2026.08.20`), `started_at` 14:02 — the storm began at the deploy.
3. Rolled the build back to `2026.08.20` in the sandbox at the same request rate: the storm cleared, confirming the change as cause.

## Deploy correlation
`/debug/deploys` shows build `2026.08.27` deployed at 14:02, coincident with the onset. The service's own logs show `handler_ms` near 2500 with an `audit_ms` of 2500 on this build — the time is spent inside an audit hook added in `2026.08.27`, not in a datastore or a pooled resource. The known-good build `2026.08.20` served `/checkout` at p99 ~20 ms under this same traffic.

## Load ruled out
Traffic was flat across the onset: the arrival rate held at ~5 req/s before and after the deploy, unchanged. Capacity is not the cause — the same rate on build `2026.08.20` returns 200s, CPU stays low while each request blocks in the audit hook, and adding replicas or raising the gateway timeout does not clear the storm.

## Root cause
Build `2026.08.27` added a synchronous audit hook to the checkout path that holds each request ~2.5 s, past the gateway's 2 s read timeout, so every request 504s under unchanged traffic. Rolling back to `2026.08.20` clears the storm; scaling does not.
