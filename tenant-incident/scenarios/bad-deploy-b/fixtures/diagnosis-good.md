---
incident: pricing-error-rate-spike
steps: 3
---
# Diagnosis — pricing error-rate spike

latch-walk: planning.md @ incident-pricing-errors

The latch "an error-rate spike with no input change" fired at plan time, directing a deploy/change correlation before treating it as bad data.

## Investigation steps
1. Read the gateway and service logs: a spike of `status=500` on `/price/*`, confined to carts 4 and 5, with a `KeyError` on `discount` in the pricing handler, onset at 11:31.
2. Correlated the onset with the deploy history rather than chasing the data: `/debug/version` reports build `2026.09.09` (previous `2026.09.02`), `started_at` 11:31 — the errors began at the deploy.
3. Rolled the build back to `2026.09.02` in the sandbox against the same carts: the 500s cleared, confirming the change as cause.

## Deploy correlation
`/debug/deploys` shows build `2026.09.09` deployed at 11:31, coincident with the onset. The service logs show the error is a `KeyError` on `discount` raised inside the pricing handler — the fault is in the deployed code, not a downstream dependency. A diff against the known-good build `2026.09.02` shows the discount read dropped its default (`item.get("discount", 0)` became `item["discount"]`).

## Input ruled out
The inputs are unchanged: the catalog and the cart mix are the same as before the onset, and the previous build `2026.09.02` priced these exact carts (4 and 5, which carry no discount) without error. The errors are not bad data — the same data was handled cleanly one build earlier.

## Root cause
Build `2026.09.09` dropped the defensive default on the discount read, so carts without a discount key raise `KeyError` and return 500 under unchanged inputs. Rolling back to `2026.09.02` restores the defensive read and clears the errors; there is nothing to fix in the data.
