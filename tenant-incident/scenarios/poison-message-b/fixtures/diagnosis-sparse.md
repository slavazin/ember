---
incident: jobs-queue-consumer-wedge
steps: 9
---
# Diagnosis — jobs queue consumer wedge

## Investigation steps
1. Noticed the pending backlog growing.
2. Restarted the worker; the backlog kept growing.
3. Assumed the worker could not keep up and scaled to three workers.
4. Backlog kept climbing; suspected Postgres was the bottleneck.
5. Gave Postgres more memory and CPU; no change.
6. Looked for a spike from the producer; the rate looked normal.
7. Added a second worker pool.
8. Re-read the worker logs for stack traces.
9. Escalated for more hands.

## Findings
The backlog keeps growing after every scaling attempt on the workers and the database. The producer rate looks normal. The cause is not yet isolated.
