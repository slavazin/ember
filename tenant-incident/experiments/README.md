# experiments/ — the multi-run round scaffold

The machinery that fans the incident responder out at scale and reads whether the corpus
the slow loop grows makes the next fan-out cheaper. This is the experiment that turns one
hand-built recurrence pair into a repeatable, error-barred learning delta (Constitution
Art. 12).

A **run** is one whole inspector session against one provisioned scenario: boot →
`investigate` → `close`. A **round** is a fan-out of N runs against ONE frozen corpus tag,
followed by ONE human slow-loop pass (`promotion-review`) that adjudicates every candidate
the round produced and advances the corpus one version. The demo evidence is the per-class
step-count curve across rounds — bending on the positive probes, flat on the controls,
checkpointed in public git.

## The three artifacts

| Artifact | File | What it is |
|---|---|---|
| Round spec | [rounds/round-0.yml](/tenant-incident/experiments/rounds/round-0.yml), [round-1.yml](/tenant-incident/experiments/rounds/round-1.yml) | The round's pre-registration: `corpus_tag` + per-scenario `{class, surface, role, runs, expect}`. |
| Round runner | [run-round.ts](/tenant-incident/experiments/run-round.ts) + [run-round-lib.ts](/tenant-incident/experiments/run-round-lib.ts) | Tags the corpus, provisions each scenario, runs N runs on their own branches, collects grades + dispositions, emits the report and ledger rows. Stops at the human gate. |
| Delta ledger | [ledger.md](/tenant-incident/experiments/ledger.md) | Append-only, git-checkpointed. One row per (round × class × surface); the demo reads from it. |

## The round spec (pre-registration)

A spec is written **before** the round and checked against the ledger **after**. Shape:

```yaml
round: 0
corpus_tag: corpus/v0        # corpus/v{k}: the frozen ref every run in the round boots
scenarios:
  - class: pool-exhaustion   # the scenario class (a scenarios/<class>-<surface> directory)
    surface: a               # a single letter; keyed on presentation, never cause
    role: anchor             # anchor | positive-probe | control | novelty | belief-falsifier
    runs: 3                  # replicate count — error bars come from replicates, not surfaces
    expect: fired-off-map    # applied | considered-not-applicable | fired-off-map
```

- **role** is what the scenario is *for* in the round matrix: `anchor` drives a promotion;
  `positive-probe` is an incident where a promoted entry should fire and cut steps;
  `control` is one where it must be consulted and set aside; `novelty` is one no entry helps
  (a clean off-map fire); `belief-falsifier` is engineered to fire a minted belief's stated
  falsifier.
- **expect** is the pre-registered close disposition. The ledger compares it to the observed
  disposition: an entry `applied` on its positive probe and `considered-not-applicable` on
  its control is the corpus working; an entry `applied` on a control is a **false-fire**, and
  a single false-fire sends the promotion back to the slow loop.
- **runs vs surfaces are different axes.** Replicates (same surface, same tag) buy error
  bars; distinct surfaces buy recurrence. N copies of one surface never clear the rule bar
  (two *distinct* surfaces); the runner reads surface-distinctness, so replicate to buy an
  interval, add a surface to buy recurrence.

`run-round.ts` validates a spec against these rules and reports every problem at once.

## The runner and its three modes

```bash
# plan (default): parse, validate, expand to runs, resolve scenario dirs, render the plan.
# No side effects — no docker, no harness, no git writes. The dry-run.
npm run round -- tenant-incident/experiments/rounds/round-0.yml

# local: drive the docker-compose scenarios directly — inject -> grade a run report -> reset.
# Exercises the battery + grading + ledger pipeline without the harness. A run's diagnosis
# report comes from --reports-dir/<scenario>/<n>.md; absent that, the scenario fixture stands
# in for pipeline shake-out. A failed inject or reset makes the run an error, and a
# fixture-backed run is never measured evidence — neither reaches the ledger (see below).
npm run round -- rounds/round-0.yml --mode local --reports-dir ./reports --emit-ledger

# harness: the real fan-out — N concurrent TrueForge sessions, OpenAI-only (ISS-003).
# Gated behind the prerequisites below; it refuses a real round until they are asserted AND
# the live fan-out is built and verified (the maintainer sets RUN_ROUND_HARNESS_WIRED=1 then).
npm run round -- rounds/round-0.yml --mode harness --prereqs-confirmed
```

Flags: `--mode plan|local|harness`, `--reports-dir DIR`, `--out DIR` (write the report file),
`--ledger PATH`, `--max-steps N` (pass a step threshold to `grade.sh`), `--tag` (freeze the
corpus tag at the current corpus HEAD — local only, never pushed), `--prereqs-confirmed`,
`--emit-ledger` (append the round's rows to the ledger).

A scenario the battery does not yet carry is reported **blocked**, not run — the runner grades
what exists and names the rest, so a pre-registration can reference the full §4 battery while
some surfaces (a fresh pool surface, the upstream grounding class) are still unbuilt.

### The human gate is structural

The runner has no code path that merges, pushes to main, or runs `promotion-review`. It files
each run to its own `run/{round}/{scenario}/{n}` branch and stops. The slow loop — the human
adjudicating the union of candidates and merging, then tagging the next corpus version — is
the human gate (Art. 2). The only durable write the runner makes is appending measured rows
to the ledger, and that append never rewrites a prior row (Art. 9).

### Only measured evidence reaches the ledger

A ledger row is measured evidence, so the ledger — the "append these" report section and the
`--emit-ledger` append alike — carries **only real graded runs**. A **fixture** stands in for
pipeline shake-out and is never counted; an **unprovisioned or unrestored** run (a failed
`inject.sh` or `reset.sh`) is an error, not a measurement. A scenario with no measured run
yields no row at all — never a misleading `n/a` row — so a canned three-step fixture or a
stack that never came up cannot establish a false cold baseline.

## Prerequisites for a real round

`plan` and `local` mode proceed without these; a real (`harness`) round cannot, and the runner
enforces that in its preflight.

- **P1 — self-driving runs (SF-1).** A run must not pause to ask the human which shape to run
  or whether to finish. The fix is invariant framing in `investigate`/`close` ("the root
  selects and fans the shapes itself"; "the close completes all deposit steps without
  pausing"), or `ask_user_question` disabled for the agent. Without P1 there is no unattended
  fan-out.
- **P2 — tenant incident/case store (SF-8).** Deposits land in the layer store today, the
  wrong home for incident learning; a genesis-minimal `tenant-incident/corpus/<store>/` gives
  a round's candidates a tenant home (Art. 7). A round without P2 grows the wrong tree.
- **P3 — corpus tagging.** The runner tags before a round; the skill registration must honour
  `ref:<tag>` (not only `ref:main`) so a round boots a frozen corpus, not the moving head.
- **P4 — close-output contract.** The `close` skill must record each entry's close disposition
  and the forecast outcome as `disposition:` / `forecast_hit:` in the run report frontmatter —
  the runner's machine-readable interface (`parseReportMeta`). Until the skill writes them, the
  `applied`/`cna`/`fired_off_map` and `forecast_hit` columns read empty even on real runs.

The `harness` preflight also requires `TRUEFORGE_URL` and an `openai/*` `TRUEFORGE_MODEL`
(ISS-003: Anthropic identity-linked keys fail), and — because the live fan-out
(`harnessRun`: session → turn → poll → artifact-grade) depends on those same unbuilt contracts
and cannot be verified here — it stays blocked until the maintainer builds and verifies that
path and sets `RUN_ROUND_HARNESS_WIRED=1`. The mode is defined and gated; its live fan-out
lands with the prerequisites, so a real round is never silently a no-op.

## Layer or tenant?

Measuring one's own learning delta is arguably a reusable GCE-layer capability, but the
*scenarios* are irreducibly tenant (Art. 7). This scaffold is built in the tenant
(`tenant-incident/experiments/`); a generic `experiment-harness` is extracted to the layer
only when a second tenant needs it — minted from a real second instance, not a guess (Art. 11).
That extraction is worth an ADR when it lands.
