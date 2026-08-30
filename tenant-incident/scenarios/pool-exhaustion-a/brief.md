# Incident brief — orders timeout storm

The `orders` service is failing under load.

## Surface

- Service: `orders` — Node.js/Express, backed by a PostgreSQL datastore.
- Entry point: an nginx gateway fronting `orders` at host port `8080` (`/orders/*`).

## Signal

- The gateway is returning a storm of `504 Gateway Timeout` responses on `/orders/*`.
- A successful `200` is rare; most requests reach the gateway's upstream read timeout and fail.
- The storm sets in as request volume climbs against the gateway.

## Blast radius

- Order requests through the gateway are failing; users placing orders see timeouts and errors.
- The failures track the `orders` surface.

## Status

- The root cause is not identified.
- Diagnose the incident from the running stack: determine why requests time out and what resolves the storm.
