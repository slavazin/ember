# Incident brief — checkout timeout storm

The `checkout` service is timing out.

## Surface

- Service: `checkout` — Node.js/Express.
- Entry point: an nginx gateway fronting `checkout` at host port `8082` (`/checkout`).

## Signal

- The gateway is returning a storm of `504 Gateway Timeout` responses on `/checkout`.
- Essentially every request crosses the gateway's upstream read timeout and fails.
- The failure appears as an abrupt step in the error rate rather than a gradual climb.

## Blast radius

- Checkout is effectively down for users; order completion fails.
- The failures track the `checkout` surface.

## Status

- The root cause is not identified.
- Diagnose the incident from the running stack: determine why requests time out and what resolves the storm.
