#!/usr/bin/env python3
"""Open-loop load generator — steady rate, cycling across carts.

Requests `BASE/{cart}` round-robin over carts 1..CARTS at a fixed arrival rate.
The cart mix is held constant across the deploy, so a rise in the error rate
cannot be blamed on a change of inputs: the same carts that priced cleanly on the
baseline build error on the regressed build. Stdlib only.

Env:
  BASE         base URL (default http://gateway:80/price)
  CARTS        highest cart id in the round-robin (default 5)
  RATE         requests per second (default 5)
  REQ_TIMEOUT  per-request timeout in seconds (default 10)
"""

import os
import sys
import time
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("BASE", "http://gateway:80/price")
CARTS = int(os.environ.get("CARTS", "5"))
RATE = float(os.environ.get("RATE", "5"))
REQ_TIMEOUT = float(os.environ.get("REQ_TIMEOUT", "10"))

interval = 1.0 / RATE if RATE > 0 else 0.2
counters = {"sent": 0, "2xx": 0, "5xx": 0, "other": 0, "err": 0}
lock = threading.Lock()


def fire(cart):
    code = -1
    try:
        req = urllib.request.Request("%s/%d" % (BASE, cart), method="GET")
        with urllib.request.urlopen(req, timeout=REQ_TIMEOUT) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception:
        code = -1
    with lock:
        counters["sent"] += 1
        if code == -1:
            counters["err"] += 1
        elif 200 <= code < 300:
            counters["2xx"] += 1
        elif code >= 500:
            counters["5xx"] += 1
        else:
            counters["other"] += 1


def reporter():
    while True:
        time.sleep(5)
        with lock:
            print(
                "[loadgen] rate=%.0f/s sent=%d 2xx=%d 5xx=%d err=%d"
                % (RATE, counters["sent"], counters["2xx"], counters["5xx"], counters["err"]),
                flush=True,
            )


def main():
    print("[loadgen] open-loop rate=%.0f/s base=%s carts=1..%d" % (RATE, BASE, CARTS), flush=True)
    threading.Thread(target=reporter, daemon=True).start()
    workers = ThreadPoolExecutor(max_workers=256)
    i = 0
    next_t = time.monotonic()
    try:
        while True:
            cart = (i % CARTS) + 1
            workers.submit(fire, cart)
            i += 1
            next_t += interval
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
