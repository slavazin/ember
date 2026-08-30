# Incident brief — catalog timeout storm

The `catalog` service is failing under load.

## Surface

- Service: `catalog` — Python/FastAPI, backed by a Redis datastore.
- Entry point: an nginx gateway fronting `catalog` at host port `8081` (`/catalog/*`).

## Signal

- The gateway is returning a storm of `504 Gateway Timeout` responses on `/catalog/*`.
- A successful `200` is rare; most requests reach the gateway's upstream read timeout and fail.
- The storm sets in as request volume climbs against the gateway.

## Blast radius

- Catalog requests through the gateway are failing; users browsing the catalog see timeouts and errors.
- The failures track the `catalog` surface.

## Status

- The root cause is not identified.
- Diagnose the incident from the running stack: determine why requests time out and what resolves the storm.
