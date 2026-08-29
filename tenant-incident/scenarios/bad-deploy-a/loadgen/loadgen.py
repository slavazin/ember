#!/usr/bin/env python3
"""Open-loop load generator — steady, modest arrival rate.

Fires requests at a fixed arrival rate independent of whether prior requests
have returned. Here the rate is steady and modest (not a surge): it is the
*normal* traffic, held constant across the deploy so the storm cannot be blamed
on a load change. On the baseline build every request returns 200; on the
regressed build every request crosses the gateway read timeout and returns 504 —
at the same rate. The rate not changing across the onset is the evidence that
capacity is not the cause.

Stdlib only — no build-time package installs.

Env:
  TARGET       full URL to request (default http://gateway:80/checkout/1)
  RATE         requests per second (default 5)
  REQ_TIMEOUT  per-request timeout in seconds; keep >= the gateway read timeout
               so the client never closes first and skews the gateway status
               (default 10)
"""

import os
import sys
import time
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TARGET = os.environ.get("TARGET", "http://gateway:80/checkout/1")
RATE = float(os.environ.get("RATE", "5"))
REQ_TIMEOUT = float(os.environ.get("REQ_TIMEOUT", "10"))

interval = 1.0 / RATE if RATE > 0 else 0.2
counters = {"sent": 0, "2xx": 0, "504": 0, "5xx": 0, "other": 0, "err": 0}
lock = threading.Lock()


def fire(_i):
    code = -1
    try:
        req = urllib.request.Request(TARGET, method="GET")
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
        elif code == 504:
            counters["504"] += 1
        elif code >= 500:
            counters["5xx"] += 1
        else:
            counters["other"] += 1


def reporter():
    while True:
        time.sleep(5)
        with lock:
            print(
                "[loadgen] rate=%.0f/s sent=%d 2xx=%d 504=%d 5xx=%d err=%d"
                % (RATE, counters["sent"], counters["2xx"], counters["504"],
                   counters["5xx"], counters["err"]),
                flush=True,
            )


def main():
    print("[loadgen] open-loop rate=%.0f/s target=%s timeout=%.0fs"
          % (RATE, TARGET, REQ_TIMEOUT), flush=True)
    threading.Thread(target=reporter, daemon=True).start()
    workers = ThreadPoolExecutor(max_workers=256)
    i = 0
    next_t = time.monotonic()
    try:
        while True:
            workers.submit(fire, i)
            i += 1
            next_t += interval
            delay = next_t - time.monotonic()
            if delay > 0:
                time.sleep(delay)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
