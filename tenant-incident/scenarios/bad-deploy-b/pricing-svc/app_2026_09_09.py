"""pricing service — build 2026.09.09 (the deployed regression).

Identical to build 2026.09.02 except one line on the pricing path: a refactor
dropped the defensive default on the discount read, so `item["discount"]` now
raises `KeyError` for any item without a discount key. Items 4 and 5 carry no
discount, so requests for those carts return 500 — a fraction of traffic errors
while the rest is fine, under unchanged inputs. The catalog is unchanged; the
previous build priced these same carts without error. The fix is to roll the
deploy back to 2026.09.02; the errors are in the service's own handler, not in
bad data or a downstream dependency.
"""

import json
import os
import time
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.responses import JSONResponse

BUILD = "2026.09.09"
PREVIOUS_BUILD = "2026.09.02"
STARTED_AT = datetime.now(timezone.utc).isoformat()

CATALOG = {
    "1": {"price": 19.99, "discount": 0.10},
    "2": {"price": 29.99, "discount": 0.15},
    "3": {"price": 9.99, "discount": 0.00},
    "4": {"price": 49.99},
    "5": {"price": 14.99},
}

app = FastAPI()


def _log(obj):
    print(json.dumps(obj), flush=True)


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "build": BUILD}


@app.get("/debug/version")
async def version():
    return {"build": BUILD, "previous_build": PREVIOUS_BUILD, "started_at": STARTED_AT}


@app.get("/debug/deploys")
async def deploys():
    return {"deploys": [
        {"build": PREVIOUS_BUILD, "at": "2026-09-02T10:30:00Z", "event": "deploy"},
        {"build": BUILD, "at": STARTED_AT, "event": "deploy"},
    ]}


@app.get("/price/{cart}")
async def price(cart: str):
    t0 = time.monotonic()
    item = CATALOG.get(cart)
    if item is None:
        return JSONResponse(status_code=404, content={"error": "unknown_cart"})
    try:
        # 2026.09.09 refactor: dropped the `.get(..., 0)` default. An item with
        # no discount key now raises KeyError — the whole regression is this line.
        discount = item["discount"]
    except KeyError:
        _log({"build": BUILD, "path": f"/price/{cart}", "error": "KeyError", "key": "discount", "status": 500})
        return JSONResponse(status_code=500, content={"error": "pricing_error"})
    total = round(item["price"] * (1 - discount), 2)
    _log({"build": BUILD, "path": f"/price/{cart}", "handler_ms": round((time.monotonic() - t0) * 1000), "status": 200})
    return {"cart": cart, "total": total, "build": BUILD}
