---
incident: orders-timeout-storm
steps: 9
---
# Diagnosis — orders timeout storm

## Investigation steps
1. Noticed elevated 504s at the gateway.
2. Restarted the gateway; the storm returned under load.
3. Suspected a slow network path and measured latency between the gateway and the service.
4. Traced the upstream call graph looking for a slow dependency.
5. Inspected the database for slow queries and locks; found several sleeping backends.
6. Raised the gateway read timeout to 5 s; the storm continued.
7. Added database resources; the timeouts did not change.
8. Re-read the service logs looking for stack traces.
9. Escalated for more hands.

## Findings
The gateway returns 504 under load. The database shows sleeping backends but no obvious errors. The cause is not yet isolated and the timeouts continue whenever load is applied.
