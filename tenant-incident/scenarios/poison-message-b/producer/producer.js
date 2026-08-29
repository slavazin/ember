'use strict';

// producer — the normal workload.
//
// Inserts valid pending rows at a steady, modest rate well under what one worker
// drains, using ids starting at 1001 so a poison row injected at id 1 is always
// the head. This is the standing traffic, not a surge: the backlog is healthy
// (near zero) until a poison row lands at the head. Holding the rate constant is
// what makes the stall attributable to the head row and not to load.

const { Pool } = require('pg');

const RATE = parseFloat(process.env.RATE || '2');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'app',
  password: process.env.PGPASSWORD || 'app',
  database: process.env.PGDATABASE || 'jobs',
  max: 2,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPg() {
  for (let i = 0; i < 60; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) { await sleep(1000); }
  }
}

async function main() {
  await waitForPg();
  const { rows } = await pool.query('SELECT COALESCE(MAX(id), 1000) AS m FROM jobs');
  let nextId = Math.max(1001, parseInt(rows[0].m, 10) + 1);
  const interval = RATE > 0 ? 1000 / RATE : 500;
  console.log(JSON.stringify({ event: 'producing', rate: RATE, start_id: nextId }));
  let n = 0;
  while (true) {
    const payload = JSON.stringify({ to: 'user' + nextId + '@example.com' });
    await pool.query(
      "INSERT INTO jobs (id, kind, payload, status) VALUES ($1, 'email', $2::jsonb, 'pending') ON CONFLICT (id) DO NOTHING",
      [nextId, payload]
    );
    nextId += 1;
    n += 1;
    if (n % 20 === 0) {
      const { rows: c } = await pool.query("SELECT count(*) AS n FROM jobs WHERE status = 'pending'");
      console.log(JSON.stringify({ event: 'produced', count: n, pending: parseInt(c[0].n, 10) }));
    }
    await sleep(interval);
  }
}

main();
