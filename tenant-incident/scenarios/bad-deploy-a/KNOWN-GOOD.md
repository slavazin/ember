# Known-good reference — checkout-svc build 2026.08.20

The reference a change-lens diagnosis diffs the running build against. It records
what the last known-good build did on this surface, so "what changed" has a
baseline to be read against.

- **Build:** `2026.08.20` (succeeds `2026.08.13`).
- **Surface:** `GET /checkout/:cart` through the gateway (`proxy_read_timeout 2s`).
- **Latency under the standing traffic (~5 req/s):** handler completes in a few
  milliseconds; observed p99 ~20 ms end-to-end; zero 504s.
- **Checkout-path work:** the catalog total only. No blocking call in the path.

The successor build `2026.08.27` is identical except for one addition on the
checkout path — an audit hook that ships `await`ed and holds each request
~2.5 s. That single change is the regression; the catalog math, the datastore
(there is none), and the traffic rate are unchanged. A diff of the two build
sources (`checkout-svc/app-2026.08.20.js` vs `app-2026.08.27.js`) shows it.
