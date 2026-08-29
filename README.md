# Ember — a governed learning layer for TrueForge

**Ember** is a reusable learning substrate for the
[TrueForge](https://github.com/truefoundry/trueforge) agent harness: a
git-backed corpus scaffold, a skill pack, and subagent role templates that give
any TrueForge agent a governed, human-gated memory. The **incident responder**
in [/tenant-incident](/tenant-incident) is the showcase that proves it — an
agent that diagnoses simulated failures in a sandbox and closes each session by
writing signal down, so that an incident of a known class can resolve in fewer
steps than the first of its class did. The layer holds **zero** incident knowledge;
the showcase supplies the domain, and the seam between them is enforced, not
promised.

Submission for the Agent Harness Hackathon (WeMakeDevs × TrueFoundry, presented
by Bright Data).

---

## What it is

Two artifacts, one submission. **The layer** is a Governed Corpus Engine (GCE)
substrate for TrueForge: knowledge lives as markdown [stores](/corpus) under one
git history, an agent may only *propose* an entry on a branch, and a human's PR
merge is the single write that admits it. **The showcase** is a self-learning
incident responder built on the layer: it fans investigation across subagents,
freezes a diagnosis forecast before probing, gates fixes behind harness
approvals, and closes by filing candidate entries through the same merge gate —
so the corpus, not the conversation thread, carries what the agent learned. The
differentiator the arc is built to demonstrate is the one a one-shot agent demo
cannot: measurable improvement across sessions, with the promotion trail
auditable in git once the loop runs (see [#honest-limits](#honest-limits)).

The design exercises the five judged harness primitives *structurally* — skills
(the read side is a three-stage progressive disclosure over `SKILL.md` packs),
subagents (proposer / examiner / recon are distinct roles, none reviewing its
own output), approvals (the push is gated; the PR merge is the durable
adjudication), sandboxed execution (every probe is designed to run in the
sandbox, nothing speculative touching a live surface), and persistent sessions
(a fresh session boots from the corpus and may not end without its close-out).
The construct-by-construct mapping and its disclosed fidelity losses are the
entry's own doctrine; the honest limits are in
[#honest-limits](#honest-limits).

## Setup

### Prerequisites

- **Node 22+** — the layer toolchain declares `engines.node` `>=22`
  ([package.json](/package.json)); the TrueForge harness's local run wants
  **Node 22.14+**.
- **Docker** with `docker compose`, to stand up the incident scenarios locally.
- Optional for the full harness path: model-provider, sandbox-provider, and MCP
  keys (added in TrueForge Settings under Track B).

### Track A — the layer toolchain (verified green, 2026-08-28)

The corpus derivation and lint scripts under [/tools](/tools) are plain
TypeScript on Node, with no harness dependency. From the repository root:

```bash
npm install
npm run typecheck   # tsc --noEmit over the toolchain
npm test            # the full test suite (layer tools + the build ADR store)
npm run gen:check   # verify each store's generated skill index matches a fresh render
npm run lint        # corpus-lint: entry contract, caps, frozen paths, layer/tenant seam
npm run adr index   # the build's ADR store (also: adr related <id> | adr scopes [paths…] | adr:check)
```

`npm run lint` prints its own **residue** — the list of what it checks for
presence and shape but never for truth or quality. That list is doctrine, not an
apology: see [#honest-limits](#honest-limits).

### Track B — running under TrueForge (the integration path)

This is the wiring path the entry is designed against, per the TrueForge docs.

1. **Install the harness** — globally, or run it on demand:

   ```bash
   pnpm add -g @truefoundry/trueforge
   # or, without a global install:
   npx @truefoundry/trueforge
   ```

2. **Start it** and open the console:

   ```bash
   trueforge --port 8790
   ```

   → <http://localhost:8790>

3. **Add keys in Settings** — a model provider under **Models**, a sandbox
   provider under **Sandbox providers** (the incident probes and every corpus
   read run in the sandbox), and any MCP servers under **Connectors** (the
   external-grounding and seed-harvest path uses the Bright Data MCP). Secrets
   are held by the harness; they never enter the corpus.

4. **Register the skills** in [/skills](/skills) by repo path, and load the
   `constitution` skill as a boot obligation in the saved agent's instructions.
   For the hackathon the skill ref tracks `main` so a merged promotion is seen
   without re-registration; the production posture is to pin a tag or SHA and
   re-register on merge.

> **Track B status.** The layer toolchain in Track A is verified green in
> [CI](/.github/workflows/ci.yml). The end-to-end harness wiring in Track B is
> the designed integration path and is not yet verified in this repository as of
> 2026-08-28; see [Status](#status) and
> [#honest-limits](#honest-limits).

## The demo arc — the learning delta

The centerpiece is one failure class seen twice, and the step reduction between
them. Both halves are built and instrumented; the three-step sequence here is
the **designed** arc the instruments measure — not a measured result (see
[#honest-limits](#honest-limits)).

- **First incident of a class.** A fresh session boots from the corpus, injects
  [pool-exhaustion-a](/tenant-incident/scenarios/pool-exhaustion-a) (a Node +
  Postgres service whose bounded connection pool saturates and presents as a
  gateway-timeout storm before any datastore error). Recon subagents fan out; a
  diagnosis forecast is frozen before probing; the probe runs in the sandbox;
  the fix pauses on a harness approval. At close, the session files one candidate
  entry through the merge gate. The pool is found late — the step count is high.
- **Promotion (human-gated).** A second surface,
  [pool-exhaustion-b](/tenant-incident/scenarios/pool-exhaustion-b) (a Python +
  Redis service — different language, framework, datastore, and pool library,
  same saturation mechanism), files the same-shaped observation. Two anchored
  recurrences clear the bar; a human merges a `decision`, then a `rule`:
  *check pool saturation before tracing upstream when a datastore-backed service
  shows a timeout storm.*
- **A later incident of the class.** A fresh session with the rule available
  checks the pool early. The grader's step count is a fraction of the first
  incident's.

**The proof against a staged "after."** Each corpus state is a merged pull
request with a timestamp; the promotion PR trail *is* the evidence that the later
session's speed was earned by the earlier ones, not scripted. The
[step-count grader](/tenant-incident/scenarios/pool-exhaustion-a/grade.sh) is the
metric, and each scenario's README states exactly what its grader does and does
not verify.

<a id="status"></a>
## Status — what runs, as of 2026-08-28

| Built and green | Designed, not yet run |
|---|---|
| The corpus scaffold — five [stores](/corpus) with README + SCHEMA pairs, and [LANGUAGE.md](/corpus/LANGUAGE.md), the binding authoring authority | The end-to-end loop under TrueForge (Track B wiring) |
| The [skill pack](/skills) and [role templates](/roles) | The measured before/after step counts (the incident corpus is genesis-empty until the loop mints entries) |
| The toolchain — `corpus-lint`, `index-gen`, the shared [index contract](/tools/INDEX-CONTRACT.md), all green in [CI](/.github/workflows/ci.yml) on Linux and Windows | The Bright Data seed harvest (postdiction beliefs) |
| A **real second tenant**, [tenant-build](/tenant-build) — the build's own ADR store, installed without touching a layer file (the reusability claim, demonstrated) | |
| The recurrence pair — [pool-exhaustion-a / -b](/tenant-incident/scenarios) — with `inject` / `reset` / `grade` scripts | |

**To fill in once the loop has run** (S-001 … S-009): the measured step counts
for the first incident and the later one, the ratio between them, and the
permalinks to the checkpoint PRs that carry each corpus state. Until those exist
in git, the demo-arc section describes the designed arc, honestly labelled.

## Qodo Code Review Evidence

Every change to this repository flows through a feature branch → pull request →
Qodo `/agentic_review` → address findings → human merge; direct pushes to `main`
are not counted as reviewed work. The merged trail:

| PR | Title |
|---|---|
| [#1](https://github.com/slavazin/ember/pull/1) | Corpus scaffold: five stores, authoring language, MIT license |
| [#2](https://github.com/slavazin/ember/pull/2) | Add index interface contract and shared derivation module |
| [#3](https://github.com/slavazin/ember/pull/3) | Add index-gen: derive store indexes into the skill shells |
| [#4](https://github.com/slavazin/ember/pull/4) | Store-index skill shells, process skills, and role templates (Stream I, Track C) |
| [#5](https://github.com/slavazin/ember/pull/5) | Add pool-exhaustion scenario pair (tenant-incident showcase) |
| [#6](https://github.com/slavazin/ember/pull/6) | Add corpus-lint: the mechanical entry-contract enforcer |
| [#7](https://github.com/slavazin/ember/pull/7) | Add CI + fix check-seam self-match on test files |
| [#8](https://github.com/slavazin/ember/pull/8) | Pin entry-file selection in the shared contract |
| [#9](https://github.com/slavazin/ember/pull/9) | Mechanize recurring blindspot classes into guards |
| [#10](https://github.com/slavazin/ember/pull/10) | Add tenant-build: the build's own ADR store |
| [#11](https://github.com/slavazin/ember/pull/11) | Wire tenant-build into the shared toolchain; make store discovery multi-root |

## <a id="honest-limits"></a>#honest-limits

This section is doctrine, not a disclaimer. A learning layer earns trust by
stating precisely where its guarantees stop — every gate named here is a *floor*,
honestly disclosed, and the review judgments it cannot make stay with the human.

- **Presence, not quality.** `corpus-lint` and the scenario graders check that a
  slot, section, or report region is *present and well-shaped* — never that its
  content is true, correct, or good. A five-slot entry passes the lint with a
  falsifier that tests the wrong quantity; a diagnosis passes the grader's
  presence gate with a pool-metrics section that was filled in without reading
  the metric. `npm run lint` prints the full residue list; each scenario README
  states its grader's blind spots.

- **Floors, not rates, and self-reported.** The demo metric is a **step count** —
  a proxy for how early the pool was checked, not a measure of diagnosis
  correctness, latency, or user impact. The count is author-declared (a `steps:`
  frontmatter field, or an ordered-list scan of the report), and
  [grade.sh](/tenant-incident/scenarios/pool-exhaustion-a/grade.sh) states in its
  own residue that it does **not** check the count reflects real work rather than
  padding. So a lower count is *consistent with* the learned rule firing early; it
  does not by itself prove the rule fired, that the investigation improved, or
  that the diagnosis was right. What establishes those is a human reading the
  report and the promotion PR trail — the designed incident ledger
  (`corpus/ledgers/incidents.md`, not yet built) would record these counts as
  *floors* (a minimum observed), never as rates.

- **The delta is designed and instrumented, not yet measured.** As of
  2026-08-28 the incident corpus is genesis-empty and the loop has not run
  end-to-end under the harness, so the before/after numbers do not yet exist in
  git. The scenario pair, the graders, and the promotion ladder are built; the
  measurement is not. The demo-arc section is labelled accordingly, and the
  [Status](#status) table separates the two.

- **Solo-judge precondition.** The promotion ladder and the approval gate presume
  a **single human adjudicator**. There is no multi-reviewer quorum, no tie-break,
  and no defense against one wrong merge — the merge *is* the adjudication. The
  layer makes that judgment auditable (the PR trail); it does not replace it.

- **Examiner independence is structural, not authorial.** TrueForge subagents are
  dynamic, so the proposing root authors the examiner's dispatch. Independence is
  real in *context* — the examiner runs in a clean window with no authoring stake
  and is handed the target text verbatim — but not in instruction authorship. The
  mitigations (frozen role templates, freeze-the-target, verdict-pending grammar,
  human adjudication) reduce the risk; they do not erase it.

- **`undercut` is omitted, deliberately.** The belief store's **designed**
  evidence-state vocabulary — computed by a `belief-scorer` that is not yet built
  (the beliefs [SCHEMA](/corpus/beliefs/SCHEMA.md) carries the frozen
  `verdict` and watch fields, not a live evidence state) — is
  `corroborated / rebutted / holding / unevaluated / unwatched`.
  The `undercut` state is left out because it is not implementable without
  machinery the doctrine itself flags as absent — the omission is disclosed
  rather than faked.

- **Learning survives context death; the layer needs a sandbox.** The corpus is
  the only carrier, so a deliberately fresh session still recovers what prior
  sessions learned — which *strengthens* the arc. The cost: skills materialize in
  the sandbox, so an agent with no sandbox cannot use the layer, and every corpus
  read happens where code runs.

- **The seam scan catches registered terms, not paraphrase.**
  `corpus-lint --check-seam` fails CI if a layer file names a tenant term, but it
  greps a *derived* term set — tenant knowledge expressed by paraphrase, or
  before the vocabulary grows the term, passes. Coverage grows with the
  vocabulary; it is not a proof of separation.

## Layer / tenant separation

The reusable layer sits at the repository root — [/corpus](/corpus),
[/skills](/skills), [/roles](/roles), [/tools](/tools) — and carries no tenant
knowledge. Each tenant is a guest under its own tree:
[/tenant-incident](/tenant-incident) is the showcase, and
[/tenant-build](/tenant-build) is a second tenant whose domain is the build's own
architecture decisions. That second tenant is the reusability claim made
concrete: it installs the layer's decision-store pattern without editing a single
layer file, and `corpus-lint --check-seam` guards the boundary in CI.

## License

[MIT](/LICENSE).
