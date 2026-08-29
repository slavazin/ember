'use strict';

// checkout service — build 2026.08.27 (the deployed regression).
//
// Identical to build 2026.08.20 except for one change on the checkout path: an
// audit hook, intended to be fire-and-forget, shipped awaited. It holds each
// request ~REGRESSION_MS before responding, so handler latency crosses the
// gateway's 2 s read timeout and every request 504s — under unchanged traffic.
// The time is spent inside the service's own added step (visible as audit_ms in
// the logs), not in a datastore or a pooled resource. The fix is to roll the
// deploy back to 2026.08.20; scaling does not help, because each request is
// intrinsically slow, not queued behind a saturated resource.

const express = require('express');

const BUILD = '2026.08.27';
const PREVIOUS_BUILD = '2026.08.20';
const PORT = parseInt(process.env.PORT || '3000', 10);
const REGRESSION_MS = parseInt(process.env.REGRESSION_MS || '2500', 10);
const STARTED_AT = new Date().toISOString();

const CATALOG = { 1: 19.99, 2: 29.99, 3: 9.99, 4: 49.99, 5: 14.99 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Added in 2026.08.27: a per-request audit write on the checkout path. Meant to
// be fire-and-forget; shipped `await`ed, so it blocks the response. This is the
// whole difference from the baseline build.
async function auditHook() {
  await sleep(REGRESSION_MS);
}

const app = express();

app.get('/healthz', (req, res) => res.json({ status: 'ok', build: BUILD }));

app.get('/debug/version', (req, res) => res.json({
  build: BUILD,
  previous_build: PREVIOUS_BUILD,
  started_at: STARTED_AT,
}));

app.get('/debug/deploys', (req, res) => res.json({
  deploys: [
    { build: PREVIOUS_BUILD, at: '2026-08-20T10:14:00Z', event: 'deploy' },
    { build: BUILD, at: STARTED_AT, event: 'deploy' },
  ],
}));

app.get('/checkout/:cart', async (req, res) => {
  const t0 = Date.now();
  const total = Object.values(CATALOG).reduce((a, b) => a + b, 0);
  await auditHook();
  console.log(JSON.stringify({
    build: BUILD, path: req.path, handler_ms: Date.now() - t0, audit_ms: REGRESSION_MS,
  }));
  res.json({ cart: req.params.cart, total, build: BUILD });
});

app.listen(PORT, () => console.log(JSON.stringify({
  event: 'listening', port: PORT, build: BUILD, regression_ms: REGRESSION_MS,
})));
