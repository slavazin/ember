---
incident: notifications-backlog-stall
steps: 9
---
# Diagnosis — notifications backlog stall

## Investigation steps
1. Noticed the notifications backlog growing.
2. Restarted the worker; the backlog kept growing.
3. Assumed the worker could not keep up and scaled to three workers.
4. Backlog kept climbing; suspected the broker was slow.
5. Increased Redis memory and CPU; no change.
6. Looked for a spike from the producer; the rate looked normal.
7. Added more worker threads.
8. Re-read the worker logs for stack traces.
9. Escalated for more hands.

## Findings
The backlog keeps growing after every scaling attempt on the workers and the broker. The producer rate looks normal. The cause is not yet isolated.
