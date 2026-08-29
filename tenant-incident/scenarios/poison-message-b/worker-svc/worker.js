'use strict';

// dispatcher worker — drains a Postgres-table work queue in strict id order.
//
// Each pass selects the lowest-id pending row, validates it, does a little work,
// and marks it done. Processing is strictly in order with head-of-line retry: a
// row that fails validation is left 'pending' and retried in place, never
// advanced — there is no dead-lettering. Under a single bad row at the head, the
// consumer wedges: it re-selects the same lowest-id pending row every pass while
// valid rows behind it (and the producer's steady inserts) pile up.
//
// The cause is bad persisted state (one poison row), read through the state lens:
// head_redelivers climbs while the head does not clear under observation — a
// stuck bad-state, not a transient blip. Its decoy is saturation: the backlog
// reads as "the consumer can't keep up," but the worker is idle between retries,
// Postgres is healthy, and a second worker would wedge on the same head.

const http = require('http');
const { Pool } = require('pg');

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '9000', 10);
const WORK_MS = parseInt(process.env.WORK_MS || '100', 10);
const RETRY_BACKOFF_MS = parseInt(process.env.RETRY_BACKOFF_MS || '500', 10);

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'app',
  password: process.env.PGPASSWORD || 'app',
  database: process.env.PGDATABASE || 'jobs',
  max: 4,
});

// In-memory read of the head's state — exposed at /debug/queue as the smoking
// gun. head_redelivers climbing while head_id holds steady is the signal.
const state = { head_id: null, head_redelivers: 0, head_error: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function validate(row) {
  if (row.kind !== 'email') throw new Error('unknown kind: ' + row.kind);
  const p = row.payload || {};
  if (!p.to) throw new Error('missing payload.to');
}

async function processOnce() {
  const { rows } = await pool.query(
    "SELECT id, kind, payload FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1"
  );
  if (rows.length === 0) {
    state.head_id = null;
    state.head_redelivers = 0;
    state.head_error = null;
    await sleep(200);
    return;
  }

  const row = rows[0];
  try {
    validate(row);
  } catch (err) {
    // Head-of-line retry: the invalid row is left 'pending' and retried in
    // place, never advanced. Nothing behind it can be processed.
    if (state.head_id === row.id) {
      state.head_redelivers += 1;
    } else {
      state.head_id = row.id;
      state.head_redelivers = 1;
      state.head_error = 'validation_failed';
    }
    const { rows: c } = await pool.query("SELECT count(*) AS n FROM jobs WHERE status = 'pending'");
    console.log(JSON.stringify({
      event: 'process_failed', row_id: row.id, error: 'validation_failed',
      detail: err.message, redelivers: state.head_redelivers, pending: parseInt(c[0].n, 10),
    }));
    await sleep(RETRY_BACKOFF_MS);
    return;
  }

  await sleep(WORK_MS);
  await pool.query("UPDATE jobs SET status = 'done' WHERE id = $1", [row.id]);
  state.head_id = null;
  state.head_redelivers = 0;
  state.head_error = null;
  console.log(JSON.stringify({ event: 'processed', row_id: row.id, kind: row.kind }));
}

async function counts() {
  const { rows } = await pool.query(
    "SELECT count(*) FILTER (WHERE status='pending') AS pending, " +
    "count(*) FILTER (WHERE status='done') AS done, " +
    "count(*) FILTER (WHERE status='dead') AS dead FROM jobs"
  );
  const r = rows[0];
  return { pending: parseInt(r.pending, 10), done: parseInt(r.done, 10), dead: parseInt(r.dead, 10) };
}

function serve() {
  http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/debug/queue') {
      try {
        const c = await counts();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          pending: c.pending, head_id: state.head_id, head_redelivers: state.head_redelivers,
          head_error: state.head_error, done: c.done, dead: c.dead,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'query_error', detail: e.message }));
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }).listen(HTTP_PORT, () => console.log(JSON.stringify({ event: 'listening', http_port: HTTP_PORT })));
}

async function waitForPg() {
  for (let i = 0; i < 60; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) { await sleep(1000); }
  }
}

async function main() {
  await waitForPg();
  serve();
  console.log(JSON.stringify({ event: 'worker_started', work_ms: WORK_MS }));
  while (true) {
    try {
      await processOnce();
    } catch (e) {
      console.log(JSON.stringify({ event: 'loop_error', detail: e.message }));
      await sleep(500);
    }
  }
}

main();
