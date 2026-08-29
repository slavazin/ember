---
incident: pricing-error-rate-spike
steps: 9
---
# Diagnosis — pricing error-rate spike

## Investigation steps
1. Noticed a spike of 500s on `/price`.
2. Assumed some carts held malformed data and started auditing the catalog rows.
3. Wrote a validator to quarantine "bad" carts 4 and 5 from traffic.
4. Suspected a downstream pricing dependency and traced its calls.
5. Added retries around the pricing call; the 500s persisted.
6. Checked CPU and memory; both moderate.
7. Looked for a schema migration on the catalog; found none.
8. Re-read the service logs for stack traces.
9. Escalated for more hands.

## Findings
The pricing service returns 500 on some carts. The catalog looks suspicious and a downstream call was considered. The cause is not yet isolated.
