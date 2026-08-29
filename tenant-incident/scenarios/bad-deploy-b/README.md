# bad-deploy-b — pricing error-rate spike (Python · deploy regression)

## What it models

The `pricing` service (Python/FastAPI) prices a cart from an in-memory catalog.
Build `2026.09.02` reads each item's discount defensively (`item.get("discount",
0)`), so items 4 and 5 — which carry no discount key — are priced at full without
error. Build `2026.09.09` is identical except one line: a refactor dropped the
default (`item["discount"]`), so those carts now raise `KeyError` and return 500.
Deployed under an unchanged cart mix, a fraction of traffic errors while the rest
is fine.

This is the **change**-class failure, the same class as
[bad-deploy-a](/tenant-incident/scenarios/bad-deploy-a) on a distinct surface:
a different language and framework (Python/FastAPI, not Node/Express) and a
different presentation (a 5xx error-rate spike, not a latency timeout storm). The
shared lesson is the class's: correlate the onset with the most recent deploy and
diff against the known-good before treating the symptom as anything else. A duty
generalized from both surfaces carries a warrant two distinct surfaces earned.

Its decoy is **bad data** (a state read): the 500s hit only some carts, which
reads as "certain carts are malformed." But the inputs are unchanged and the
previous build priced those same carts cleanly — the data is fine; the code that
reads it changed. Auditing or quarantining carts does not fix it; rolling the
deploy back does.

## The surface

- **Gateway:** nginx — logs `upstream_status` so the 200/500 mix is legible;
  generous 5 s read timeout (the storm is errors, not timeouts). Host port `8083`.
- **Service:** `pricing-svc` — Python/FastAPI, deployable as build `2026.09.02`
  (baseline) or `2026.09.09` (regressed) via the `BUILD` env; both build sources
  ship in the image so a rollback is a redeploy, not a rebuild. Host port `3003`
  (direct access to `/debug/version` and `/debug/deploys`).
- **Traffic:** `loadgen` — open-loop ~5 req/s, round-robin over carts 1..5, held
  constant across the deploy. Off until `inject.sh` starts it, then left running.
- **Reference:** [KNOWN-GOOD.md](/tenant-incident/scenarios/bad-deploy-b/KNOWN-GOOD.md) —
  what build `2026.09.02` did on this surface, the diff target for a change read.

## Run

```bash
./inject.sh                          # baseline up, start steady traffic, then deploy 2026.09.09 → the 500 spike on carts 4,5
curl -s localhost:3003/debug/version # the smoking gun: {"build":"2026.09.09","previous_build":"2026.09.02","started_at":<onset>}
curl -s -o /dev/null -w '%{http_code}\n' localhost:8083/price/4  # 500 on the regressed build; 200 on cart 1
docker compose logs gateway          # a mix of status=200 and status=500 on /price/*
docker compose logs pricing-svc      # KeyError on 'discount' for carts 4 and 5 — the error is in the handler
./reset.sh                           # roll back to 2026.09.02 under the same traffic → carts 4,5 price cleanly again
./grade.sh path/to/diagnosis.md      # score a diagnosis report (defaults to fixtures/diagnosis-good.md)
docker compose down -v               # tear down
```

## The mechanism, as an input partition

- The catalog has 5 items; items **4 and 5 carry no `discount` key** (fixed,
  unchanged across builds).
- Baseline `2026.09.02` reads `item.get("discount", 0)` → every cart returns 200.
- Regressed `2026.09.09` reads `item["discount"]` → carts 4 and 5 raise
  `KeyError` → **500**; carts 1–3 still 200.
- The cart mix is **held constant across the deploy**, so the offered inputs are
  identical before and after; only the build changed. The error rate is the
  fraction of the mix that lacks a discount (~40% at carts 1..5 round-robin).
- Auditing or quarantining "bad" carts does not fix it — the carts are valid and
  priced cleanly one build earlier. Rolling back to `2026.09.02` restores the
  defensive read at the same inputs.

A diagnosis resolves this spike only by tying the onset to the deploy and rolling
it back; no data cleanup or dependency action fixes it.

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
- an **input-ruled-out line** — the inputs/catalog/carts named as unchanged or
  handled by the prior build (the decoy for this surface is bad data);
- a **latch-walk attestation** — a `latch-walk:` line or a "Latch walk" heading.

It does not check:
- that any number in the report is correct;
- that the diagnosis is right or that the named rollback would work;
- that a matched section carries meaningful content — a heading with the right
  words passes, which is presence, not correctness;
- that the step count reflects real work rather than padding.

The step count is the demo metric: an incident where the deploy is correlated
late (after a data-audit detour) scores a high count; a later incident of this
class where the deploy is correlated early scores a fraction of it.
`fixtures/diagnosis-good.md` passes every gate at 3 steps;
`fixtures/diagnosis-sparse.md` chases the data, fails the change-correlation gate,
and scores 9 — the two show the gates discriminate.

## Limits

- The latch-walk gate presumes a responder that records a latch-walk line; a
  correct change diagnosis from another producer fails only that gate. The
  canonical attestation format lives in [/corpus/latches/README.md](/corpus/latches/README.md).
- `reset.sh` performs the real-world mitigation (rollback), so here reset and the
  fix coincide; no residue remains once rolled back. The regressed build stays in
  the image, re-deployable — that is what `inject.sh` re-asserts.
- Scenario prose follows [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) by
  discipline; the corpus banned-tell lint does not yet range over `scenarios/`.
- The stack runs under `docker compose` locally. Provisioning it into a Daytona
  sandbox is a later step and presumes the sandbox runs `docker compose`.
