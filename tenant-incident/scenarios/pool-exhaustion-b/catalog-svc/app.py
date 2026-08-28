"""catalog service — holds a small client-side connection pool to Redis.

Each request checks out a pooled connection and holds it about HOLD_SECONDS in a
blocking read (`BRPOP` on a normally-empty list). BRPOP parks the client
server-side without loading single-threaded Redis — blocked clients are cheap,
so the pool, not the server, is the bottleneck. This mirrors the orders scenario
(`pg_sleep` on a Postgres pool): a datastore operation occupies the pooled
connection while the datastore stays able to serve others.

Under a load surge the pool exhausts and requests queue for a connection; the
wait crosses the gateway's read timeout, so the gateway returns a 504 storm
while Redis stays healthy and emits no error.
"""

import json
import os
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from redis.asyncio.connection import BlockingConnectionPool

POOL_MAX = int(os.environ.get("POOL_MAX", "5"))
HOLD_SECONDS = float(os.environ.get("HOLD_SECONDS", "1"))
REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
# Pool acquisition timeout. Higher than the gateway read timeout, so the storm
# presents as gateway 504s. When it fires under sustained saturation it raises a
# POOL-side error, never a datastore error.
ACQUIRE_TIMEOUT_S = float(os.environ.get("ACQUIRE_TIMEOUT_S", "5"))
# Whole-second BRPOP timeout, floored at 1 so it can never be 0 (which BRPOP
# reads as "block forever").
BRPOP_TIMEOUT = max(1, int(round(HOLD_SECONDS)))

pool = BlockingConnectionPool(
    max_connections=POOL_MAX,
    timeout=ACQUIRE_TIMEOUT_S,
    host=REDIS_HOST,
    port=REDIS_PORT,
)

# Pool counters (single worker, single event loop → no lock needed).
stats = {"in_use": 0, "waiting": 0}

app = FastAPI()


def _log(obj):
    print(json.dumps(obj), flush=True)


@app.get("/healthz")
async def healthz():
    # Never checks out a pooled connection, so it stays responsive while the
    # pool-consuming path is saturated.
    return {"status": "ok"}


@app.get("/debug/pool")
async def debug_pool():
    # The smoking gun. Reads counters; no checkout.
    return {"max": POOL_MAX, "in_use": stats["in_use"], "waiting": stats["waiting"]}


@app.get("/catalog/{item_id}")
async def catalog(item_id: str):
    t0 = time.monotonic()

    stats["waiting"] += 1
    conn = None
    try:
        conn = await pool.get_connection("BRPOP")
    except Exception as err:  # pool acquisition timed out — a POOL-side error
        _log({
            "path": f"/catalog/{item_id}",
            "pool_wait_ms": round((time.monotonic() - t0) * 1000),
            "error": "pool_acquire_timeout",
            "detail": str(err),
        })
    finally:
        stats["waiting"] -= 1
    if conn is None:
        return JSONResponse(status_code=503, content={"error": "pool_acquire_timeout"})

    stats["in_use"] += 1
    t_acq = time.monotonic()
    try:
        # The blocking command holds the pooled connection for its duration.
        await conn.send_command("BRPOP", "restock:queue", BRPOP_TIMEOUT)
        await conn.read_response()
        _log({
            "path": f"/catalog/{item_id}",
            "pool_wait_ms": round((t_acq - t0) * 1000),
            "redis_op_ms": round((time.monotonic() - t_acq) * 1000),
        })
        return {"item": item_id, "reserved": False}
    except Exception as err:
        _log({"path": f"/catalog/{item_id}", "error": "op_error", "detail": str(err)})
        return JSONResponse(status_code=500, content={"error": "op_error"})
    finally:
        stats["in_use"] -= 1
        await pool.release(conn)


@app.on_event("startup")
async def _startup():
    _log({"event": "listening", "pool_max": POOL_MAX, "hold_seconds": HOLD_SECONDS})
