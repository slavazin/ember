-- The work queue as a Postgres table. Rows are consumed in strict id order; a
-- row that fails validation is left 'pending' and retried in place (the worker
-- has no dead-lettering), so a single bad row at the head wedges the consumer
-- while valid rows behind it wait. The producer inserts ids >= 1001; a poison
-- row injected at id 1 is therefore always the head.

CREATE TABLE IF NOT EXISTS jobs (
  id      integer PRIMARY KEY,
  kind    text    NOT NULL,
  payload jsonb   NOT NULL,
  status  text    NOT NULL DEFAULT 'pending'
);
