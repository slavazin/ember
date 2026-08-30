# Incident brief — pricing error spike

The `pricing` service is returning errors on a fraction of requests.

## Surface

- Service: `pricing` — Python/FastAPI.
- Entry point: an nginx gateway fronting `pricing` at host port `8083` (`/price/*`).

## Signal

- The gateway shows a mix of `200` and `500` on `/price/*`: a steady fraction of pricing requests return `500 Internal Server Error` while the rest succeed.
- The error rate appears as an abrupt step up rather than a gradual climb.

## Blast radius

- Some pricing requests fail; the pricing path errors for the affected fraction of traffic.
- The remaining requests continue to succeed.

## Status

- The root cause is not identified.
- Diagnose the incident from the running stack: determine why the requests error and what resolves the spike.
