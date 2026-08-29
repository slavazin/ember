#!/usr/bin/env python3
"""producer — the normal workload.

Enqueues valid jobs onto the tail of the `jobs` list at a steady, modest rate
well under what one worker drains. This is the standing traffic, not a surge: the
backlog is healthy (near zero) until a poison message lands at the head. Holding
the producer rate constant is what makes the stall attributable to the head
message and not to load.

Env:
  REDIS_HOST  redis host (default redis)
  QUEUE       work list key (default jobs)
  RATE        jobs per second (default 2)
"""

import json
import os
import time

import redis

REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
QUEUE = os.environ.get("QUEUE", "jobs")
RATE = float(os.environ.get("RATE", "2"))

r = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)


def main():
    for _ in range(60):
        try:
            r.ping()
            break
        except Exception:
            time.sleep(1)
    interval = 1.0 / RATE if RATE > 0 else 0.5
    print(json.dumps({"event": "producing", "rate": RATE, "queue": QUEUE}), flush=True)
    i = 0
    while True:
        i += 1
        job = {"id": i, "type": "email", "payload": {"to": "user%d@example.com" % i}}
        r.rpush(QUEUE, json.dumps(job))
        if i % 20 == 0:
            print(json.dumps({"event": "produced", "count": i, "depth": r.llen(QUEUE)}), flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    main()
