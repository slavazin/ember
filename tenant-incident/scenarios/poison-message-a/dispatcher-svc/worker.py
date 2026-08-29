#!/usr/bin/env python3
"""dispatcher worker — drains a Redis list queue in strict FIFO order.

Each pass peeks the head of the `jobs` list, parses it as a job, does a little
work, and pops it. Processing is strictly in order with head-of-line retry: a
message that fails to parse is retried in place and never popped, so nothing
behind it is processed. There is no poison handling — that gap is the standing
fault. Under a single malformed message at the head, the queue backs up without
bound while the worker sits idle between retries.

The cause is bad persisted *state* (one poison message), read through the
`state` lens: `head_redelivers` climbs and the head does not clear under
observation, which is a stuck bad-state, not a transient blip. Its decoy is
saturation — the backlog looks like the worker cannot keep up — but the worker
is CPU-idle, Redis is healthy, and adding a worker only blocks a second consumer
on the same head.

Stdlib + redis client only.

Env:
  REDIS_HOST    redis host (default redis)
  QUEUE         work list key (default jobs)
  DLQ           dead-letter list key (default jobs:dlq)
  HTTP_PORT     debug/health port (default 9000)
  WORK_MS       per-message processing time on the happy path (default 100)
  RETRY_BACKOFF seconds to sleep after a failed head parse (default 0.5)
"""

import hashlib
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import redis

REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
QUEUE = os.environ.get("QUEUE", "jobs")
DLQ = os.environ.get("DLQ", "jobs:dlq")
HTTP_PORT = int(os.environ.get("HTTP_PORT", "9000"))
WORK_MS = int(os.environ.get("WORK_MS", "100"))
RETRY_BACKOFF = float(os.environ.get("RETRY_BACKOFF", "0.5"))

r = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)

# In-memory read of the head's state — exposed at /debug/queue as the smoking
# gun. head_redelivers climbing while the head_id holds steady is the signal.
state = {"head_id": None, "head_redelivers": 0, "head_error": None}
lock = threading.Lock()


def head_id_of(raw):
    # A message we cannot parse still needs a stable id to count redeliveries by.
    return hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()[:8]


def parse_job(raw):
    msg = json.loads(raw)
    if not isinstance(msg, dict) or "id" not in msg or "type" not in msg:
        raise ValueError("missing required fields (id, type)")
    return msg


def process_once():
    raw = r.lindex(QUEUE, 0)
    if raw is None:
        with lock:
            state.update(head_id=None, head_redelivers=0, head_error=None)
        time.sleep(0.2)
        return

    hid = head_id_of(raw)
    try:
        msg = parse_job(raw)
    except Exception as e:
        # Head-of-line retry: the malformed head is retried in place, never
        # popped. Nothing behind it can be processed. No dead-lettering here —
        # that is the missing poison handling this scenario models.
        with lock:
            if state["head_id"] == hid:
                state["head_redelivers"] += 1
            else:
                state.update(head_id=hid, head_redelivers=1, head_error="deserialize_failed")
            redelivers = state["head_redelivers"]
        print(json.dumps({
            "event": "process_failed", "msg_id": hid, "error": "deserialize_failed",
            "detail": str(e), "redelivers": redelivers, "depth": r.llen(QUEUE),
        }), flush=True)
        time.sleep(RETRY_BACKOFF)
        return

    # Happy path: a little work, then remove exactly the message we processed —
    # by value, not an unconditional LPOP. Between the LINDEX peek above and this
    # removal, inject.sh may LPUSH the poison onto the head; an unconditional LPOP
    # would then remove the poison instead of the job just processed, and the
    # wedge would never set in. LREM by value removes the processed job wherever
    # it now sits and never touches a concurrently-injected head.
    time.sleep(WORK_MS / 1000.0)
    r.lrem(QUEUE, 1, raw)
    with lock:
        state.update(head_id=None, head_redelivers=0, head_error=None)
    print(json.dumps({
        "event": "processed", "msg_id": msg.get("id"), "type": msg.get("type"),
        "depth": r.llen(QUEUE),
    }), flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._json({"status": "ok"})
        elif self.path == "/debug/queue":
            with lock:
                s = dict(state)
            self._json({
                "depth": r.llen(QUEUE),
                "head_id": s["head_id"],
                "head_redelivers": s["head_redelivers"],
                "head_error": s["head_error"],
                "dlq_depth": r.llen(DLQ),
            })
        else:
            self._json({"error": "not_found"}, code=404)


def serve():
    HTTPServer(("0.0.0.0", HTTP_PORT), Handler).serve_forever()


def main():
    for _ in range(60):
        try:
            r.ping()
            break
        except Exception:
            time.sleep(1)
    threading.Thread(target=serve, daemon=True).start()
    print(json.dumps({"event": "listening", "http_port": HTTP_PORT, "queue": QUEUE}), flush=True)
    while True:
        try:
            process_once()
        except Exception as e:
            print(json.dumps({"event": "loop_error", "detail": str(e)}), flush=True)
            time.sleep(0.5)


if __name__ == "__main__":
    main()
