---
incident: checkout-timeout-storm
steps: 9
---
# Diagnosis — checkout timeout storm

## Investigation steps
1. Noticed elevated 504s at the gateway.
2. Restarted the gateway; the storm returned.
3. Suspected the service was overloaded and added two more replicas.
4. Raised the gateway read timeout to 5 s; requests became slow 200s but stayed slow.
5. Inspected a database for slow queries; found nothing relevant.
6. Checked CPU and memory on the host; both moderate.
7. Scaled the host to a larger instance; no change.
8. Re-read the service logs looking for stack traces.
9. Escalated for more hands.

## Findings
The checkout service returns 504 and stays slow after scaling. CPU looks fine but the timeouts continue. The cause is not yet isolated.
