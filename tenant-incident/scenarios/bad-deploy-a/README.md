# bad-deploy-a — checkout timeout storm (Node · deploy regression)

## What it models

The `checkout` service (Node.js/Express) is fronted by an nginx gateway with a
2 s upstream read timeout. Build `2026.08.20` serves `/checkout` in a few
milliseconds. Build `2026.08.27` is identical except for one change on the
checkout path: an audit hook, meant to be fire-and-forget, that shipped `await`ed
and holds each request ~2.5 s. Deployed under unchanged traffic, it pushes every
request past the gateway timeout, so the gateway returns a storm of 504s.

This is the **change**-class failure: the cause is a deploy, and it is found by
correlating the symptom onset with the most recent deploy and diffing the running
build against the last known-good — not by reading a resource for saturation.

Its decoy is **saturation**: the 504 storm looks exactly like an overload, and a
naive read reaches for scaling. But traffic was flat across the onset, CPU stays
low (the request blocks in the hook, it does not burn cycles), and the previous
build serves the same rate cleanly. Scaling and timeout-raising do not clear it;
only rolling the deploy back does. A second surface of this class (`bad-deploy-b`,
an error-rate regression) is a later step.

## The surface

- **Gateway:** nginx — `proxy_read_timeout 2s`, single upstream,
  `proxy_next_upstream off`. Host port `8082`.
- **Service:** `checkout-svc` — Node.js/Express, deployable as build
  `2026.08.20` (baseline) or `2026.08.27` (regressed) via the `BUILD` env; both
  build sources ship in the image so a rollback is a redeploy, not a rebuild.
  Host port `3002` (direct access to `/debug/version` and `/debug/deploys`).
- **Traffic:** `loadgen` — open-loop ~5 req/s, held constant across the deploy.
  Off until `inject.sh` starts it, then left running as the standing traffic.
- **Reference:** [KNOWN-GOOD.md](/tenant-incident/scenarios/bad-deploy-a/KNOWN-GOOD.md) —
  what build `2026.08.20` did on this surface, the diff target for a change read.

## Run

```bash
./inject.sh                          # baseline up, start steady traffic, then deploy 2026.08.27 → the 504 storm
curl -s localhost:3002/debug/version # the smoking gun: {"build":"2026.08.27","previous_build":"2026.08.20","started_at":<onset>}
curl -s localhost:3002/debug/deploys # the deploy history, latest deploy at the onset
docker compose logs gateway          # the 504 storm, upstream_time at the 2 s timeout
docker compose logs checkout-svc     # handler_ms ~2500 with audit_ms ~2500 — time is in the service's own added step
./reset.sh                           # roll back to 2026.08.20 under the same traffic → healthy again
./grade.sh path/to/diagnosis.md      # score a diagnosis report (defaults to fixtures/diagnosis-good.md)
docker compose down -v               # tear down
```

## The mechanism, as a latency budget

- Gateway read timeout = **2 s**; a request over budget returns 504.
- Baseline `2026.08.20` handler ≈ **12 ms** < 2 s → 200.
- Regressed `2026.08.27` handler ≈ **2500 ms** (the awaited audit hook) > 2 s →
  504, on **every** request, independent of the arrival rate.
- Traffic is held at **~5 req/s across the deploy**, so the offered load is
  identical before and after; only the build changed.
- Scaling does not help: each request is intrinsically over budget, not queued
  behind a saturated resource, so more replicas or CPU move nothing. Raising the
  gateway timeout only turns 504s into slow 200s. Rolling back to `2026.08.20`
  restores a sub-budget handler at the same rate.

A diagnosis resolves this storm only by tying the onset to the deploy and rolling
it back; no scaling or resource action fixes it.

## What grade.sh checks — and what it does not

`grade.sh` scores a diagnosis report by presence and step count. It is a floor,
not a judge.

It checks:
- **step count** — authoritative from a `steps:` frontmatter integer, otherwise
  counted from ordered-list items outside code fences (the method used is
  printed);
- a **change-correlation section** (the required gate) — a heading naming the
  deploy/build/version with a correlation token (onset, rollback, previous build)
  inside it;
- a **load-ruled-out line** — traffic/capacity named as flat or excluded;
- a **latch-walk attestation** — a `latch-walk:` line or a "Latch walk" heading.

It does not check:
- that any number in the report is correct;
- that the diagnosis is right or that the named rollback would work;
- that a matched section carries meaningful content — a heading with the right
  words passes, which is presence, not correctness;
- that the step count reflects real work rather than padding.

The step count is the demo metric: an incident where the deploy is correlated
late (after a scaling detour) scores a high count; a later incident of this class
where the deploy is correlated early scores a fraction of it.
`fixtures/diagnosis-good.md` passes every gate at 3 steps;
`fixtures/diagnosis-sparse.md` chases scaling, fails the change-correlation gate,
and scores 9 — the two show the gates discriminate.

## Limits

- The latch-walk gate presumes a responder that records a latch-walk line; a
  correct change diagnosis from another producer fails only that gate. The
  canonical attestation format lives in [/corpus/latches/README.md](/corpus/latches/README.md).
- `reset.sh` performs the real-world mitigation (rollback), so here reset and the
  fix coincide; unlike a latent-config scenario, no residue remains once rolled
  back. The regressed build stays in the image, re-deployable — that is what
  `inject.sh` re-asserts.
- Scenario prose follows [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) by
  discipline; the corpus banned-tell lint does not yet range over `scenarios/`.
- The stack runs under `docker compose` locally. Provisioning it into a Daytona
  sandbox is a later step and presumes the sandbox runs `docker compose`.
