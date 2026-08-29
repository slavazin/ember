"""pricing service — build 2026.09.02 (baseline, known-good).

Computes a cart price from an in-memory catalog. Reads each item's discount
defensively with a default, so an item that carries no discount key is priced at
full — sparse catalog data the baseline handles without error. This build
succeeds 2026.08.26 and is the reference a change-lens diagnosis diffs the running
build against. The successor 2026.09.09 is identical except for how the discount
is read — see app_2026_09_09.py.
"""

import json
import os
import time
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.responses import JSONResponse

BUILD = "2026.09.02"
PREVIOUS_BUILD = "2026.08.26"
STARTED_AT = datetime.now(timezone.utc).isoformat()

# Catalog. Items 4 and 5 carry no `discount` key — realistic sparse data. The
# data is fixed across builds, so it is never itself the regression.
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
        {"build": PREVIOUS_BUILD, "at": "2026-08-26T09:00:00Z", "event": "deploy"},
        {"build": BUILD, "at": STARTED_AT, "event": "deploy"},
    ]}


@app.get("/price/{cart}")
async def price(cart: str):
    t0 = time.monotonic()
    item = CATALOG.get(cart)
    if item is None:
        return JSONResponse(status_code=404, content={"error": "unknown_cart"})
    # Defensive read — the baseline behavior. An item without a discount is
    # priced at full, not an error.
    discount = item.get("discount", 0)
    total = round(item["price"] * (1 - discount), 2)
    _log({"build": BUILD, "path": f"/price/{cart}", "handler_ms": round((time.monotonic() - t0) * 1000), "status": 200})
    return {"cart": cart, "total": total, "build": BUILD}
