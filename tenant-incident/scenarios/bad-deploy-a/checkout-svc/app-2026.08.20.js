'use strict';

// checkout service — build 2026.08.20 (baseline, known-good).
//
// Computes a cart total from an in-memory catalog and returns. Nothing in the
// request path blocks: the handler completes in a few milliseconds. This build
// succeeds 2026.08.13 and is the reference a change-lens diagnosis diffs the
// running build against. The successor build 2026.08.27 is identical except for
// one addition on the checkout path — see app-2026.08.27.js.

const express = require('express');

const BUILD = '2026.08.20';
const PREVIOUS_BUILD = '2026.08.13';
const PORT = parseInt(process.env.PORT || '3000', 10);
const STARTED_AT = new Date().toISOString();

// Fixed catalog; the math is unchanged across builds, so it is never the
// regression.
const CATALOG = { 1: 19.99, 2: 29.99, 3: 9.99, 4: 49.99, 5: 14.99 };

const app = express();

// Liveness — no work in the path, so it answers while the checkout path is slow.
app.get('/healthz', (req, res) => res.json({ status: 'ok', build: BUILD }));

// The deploy identity — the smoking gun for a change-lens read: which build is
// running, and which it succeeded.
app.get('/debug/version', (req, res) => res.json({
  build: BUILD,
  previous_build: PREVIOUS_BUILD,
  started_at: STARTED_AT,
}));

// The deploy history — the current build's `at` is this process's start, so a
// responder can line the latest deploy up against the symptom onset.
app.get('/debug/deploys', (req, res) => res.json({
  deploys: [
    { build: PREVIOUS_BUILD, at: '2026-08-13T09:02:00Z', event: 'deploy' },
    { build: BUILD, at: STARTED_AT, event: 'deploy' },
  ],
}));

// The checkout path. Logs where the time goes: handler_ms is small on this
// build because the handler does only the catalog math.
app.get('/checkout/:cart', (req, res) => {
  const t0 = Date.now();
  const total = Object.values(CATALOG).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ build: BUILD, path: req.path, handler_ms: Date.now() - t0 }));
  res.json({ cart: req.params.cart, total, build: BUILD });
});

app.listen(PORT, () => console.log(JSON.stringify({
  event: 'listening', port: PORT, build: BUILD,
})));
