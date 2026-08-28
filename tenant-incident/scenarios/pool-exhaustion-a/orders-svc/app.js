'use strict';

// orders service — holds a small client-side connection pool to PostgreSQL.
// Each request checks out a pooled connection and holds it ~HOLD_SECONDS of
// datastore work (pg_sleep). Under a load surge the pool saturates and requests
// queue for a connection; the wait crosses the gateway's read timeout, so the
// gateway returns a 504 storm while Postgres stays healthy and emits no error.

const express = require('express');
const { Pool } = require('pg');

const POOL_MAX = parseInt(process.env.POOL_MAX || '5', 10);
const HOLD_SECONDS = parseFloat(process.env.HOLD_SECONDS || '1');
const PORT = parseInt(process.env.PORT || '3000', 10);
// Pool acquisition timeout. Higher than the gateway read timeout, so the storm
// presents as gateway 504s. When it does fire under sustained saturation it
// raises a POOL-side error, never a datastore error.
const ACQUIRE_TIMEOUT_MS = parseInt(process.env.ACQUIRE_TIMEOUT_MS || '5000', 10);

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'app',
  password: process.env.PGPASSWORD || 'app',
  database: process.env.PGDATABASE || 'shop',
  max: POOL_MAX,
  connectionTimeoutMillis: ACQUIRE_TIMEOUT_MS,
});

const app = express();

// Liveness. Never checks out a pooled connection, so it stays responsive while
// the pool-consuming path is saturated.
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// Pool-saturation metrics — the smoking gun. Reads pool counters; no checkout.
app.get('/debug/pool', (req, res) => {
  res.json({
    max: POOL_MAX,
    total: pool.totalCount,
    idle: pool.idleCount,
    in_use: pool.totalCount - pool.idleCount,
    waiting: pool.waitingCount,
  });
});

// The pool-consuming path. Separates pool-wait time from datastore time so the
// logs show where the time goes: pool_wait_ms climbs under saturation while
// db_query_ms holds flat near the hold.
app.get('/orders/:id', async (req, res) => {
  const t0 = Date.now();
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.log(JSON.stringify({
      path: req.path,
      pool_wait_ms: Date.now() - t0,
      error: 'pool_acquire_timeout',
      detail: err.message,
    }));
    return res.status(503).json({ error: 'pool_acquire_timeout' });
  }
  const tAcquired = Date.now();
  try {
    // pg_sleep runs unconditionally, so the connection is held for the hold
    // regardless of whether the row exists.
    await client.query('SELECT pg_sleep($1)', [HOLD_SECONDS]);
    const q = await client.query(
      'SELECT id, sku, price FROM orders WHERE id = $1',
      [req.params.id]
    );
    console.log(JSON.stringify({
      path: req.path,
      pool_wait_ms: tAcquired - t0,
      db_query_ms: Date.now() - tAcquired,
    }));
    res.json({ order: q.rows[0] || null });
  } catch (err) {
    console.log(JSON.stringify({ path: req.path, error: 'query_error', detail: err.message }));
    res.status(500).json({ error: 'query_error' });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(JSON.stringify({
    event: 'listening', port: PORT, pool_max: POOL_MAX, hold_seconds: HOLD_SECONDS,
  }));
});
