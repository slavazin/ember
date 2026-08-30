---
name: close
description: The fast-loop close-out, run after implementation from fresh context — record dispositions, walk the retro lenses, file candidates, and walk the closing latches into the session's pull request.
---

# close — the fast-loop close-out

The close half of the fast loop, split from boot so it runs from fresh context:
implementation is done, and the close-out judges it without carrying the
implementer's context. Learning is corpus-carried, not thread-carried — the close
is where a session deposits what the next boot recovers. The record is the
session's pull request; git history is the trace, with no session log and no
carry-forward file.

Load this at close, after implementation. It re-derives its inputs from the branch
and the pull request, so an agent holding none of the implementation context can
run it in full.

## The close runs to completion (invariant)

**The close completes every deposit step in one pass — it does not pause to ask
the human whether to finish.** Recording dispositions, walking the retro lenses,
writing the run's close facts into the report frontmatter, drafting and filing
candidates through the `corpus-write` skill, walking the closing latches, and
emitting the deposit for filing are the close's own work, run start to finish
without a confirmation prompt. The environment supplies evidence, not permission to
proceed.

Completion is running every close step through to the hand-off — dispositions
recorded, retro lenses walked, the run's close facts written to the report
frontmatter, candidates filed through the `corpus-write` skill, closing latches
walked — without pausing partway. The environment supplies evidence, not permission
to proceed. How the result is filed is the `corpus-write` filing procedure's to
settle (ADR-0009), not this skill's to restate: the push is approval-gated at the
tool boundary, and in the incident-responder loop the sandbox holds no push
credential of its own and hands its work to the host. The close's own duty is to
reach that hand-off without stopping to confirm; it never stalls waiting on a push
the sandbox cannot perform, and the one human gate is the merge (Article 2), not a
mid-run approval.

An unattended close turns on this invariant: a close that halts mid-walk to
confirm never reaches the pull request the next boot reads.

**Do:** walk the close end to end and file the pull request in the same pass.
**Don't:** don't halt mid-close to confirm whether to finish — the deposit steps
are owed by the skill, and the human gate is the merge, not a mid-run approval.

## Corpus reachability (invariant)

**The corpus is ensured reachable before any corpus read.** Every `/corpus/…` path
this skill reads — the lens language, the closing latch table — resolves through a
repo-root symlink the sandbox does not carry by default, and the sandbox is
recycled after an idle interval, dropping a corpus provisioned once at boot while
the harness re-clones only the skills. So reachability is an **invariant
re-ensured before each corpus-touching read**, never a boot-once step: discharge it
with an idempotent guard that no-ops when the corpus already resolves and
self-heals when a recycle has dropped it.

    # The harness clones each registered skill into this sandbox and passes AGENT_GIT_SKILLS —
    # a base64 JSON list of {name,url,path,ref}, one per skill, every one from the ember repo at
    # the ref the round registered it at. Read the ember origin URL and the ref THIS skill was
    # registered at — matched by name in that list, so a non-corpus skill left at main cannot pull
    # the clone off a frozen tag — so the corpus resolves at the SAME ref as the skill reading it:
    # a frozen-tag round pins the corpus by registering the corpus-facing skills at corpus/v{k},
    # and each clone mirrors its own skill's ref instead of tracking the moving head.
    # EMBER_CORPUS_REF (the ref) or EMBER_ORIGIN (the URL) override when
    # set; the ref falls back to main. Clone into a scratch path and swap it in only once the
    # checkout succeeds, so an interrupted prior run leaves no partial /corpus behind; every step
    # is chained, so a failure publishes no links.
    # The guard tests BOTH published roots — /corpus and the tenant /tenant-incident/corpus —
    # so a partial provisioning (one link present, the other dropped or never made) re-heals
    # instead of reading as done and failing the tenant read.
    { [ -e /corpus/README.md ] && [ -e /tenant-incident/corpus/README.md ]; } || {
      _tf_skills=$(printf %s "${AGENT_GIT_SKILLS:-}" | base64 -d 2>/dev/null || printf '[]') &&
      _tf_origin="${EMBER_ORIGIN:-$(printf %s "$_tf_skills" | jq -r --arg n close '([.[]|select(.name==$n).url]+[.[].url]|map(select(.!=null)))[0] // empty')}" &&
      _tf_ref="${EMBER_CORPUS_REF:-$(printf %s "$_tf_skills" | jq -r --arg n close '([.[]|select(.name==$n).ref]+[.[].ref]|map(select(.!=null)))[0] // empty')}" &&
      _tf_ref="${_tf_ref:-main}" &&
      rm -rf /opt/tf/corpus-src.tmp &&
      git clone --no-checkout --depth 1 --filter=blob:none --branch "$_tf_ref" "$_tf_origin" /opt/tf/corpus-src.tmp &&
      git -C /opt/tf/corpus-src.tmp sparse-checkout set corpus tenant-incident/corpus &&
      git -C /opt/tf/corpus-src.tmp checkout &&
      rm -rf /opt/tf/corpus-src && mv /opt/tf/corpus-src.tmp /opt/tf/corpus-src &&
      ln -sfn /opt/tf/corpus-src/corpus /corpus &&
      ln -sfn /opt/tf/corpus-src/tenant-incident /tenant-incident
    }

The sparse set is `corpus/` **plus** `tenant-incident/corpus/`, and it excludes
`tenant-incident/scenarios/`: the scenario is the environment, and an agent that
can read the scenario reads the mechanism and the fix instead of investigating them
— the environment supplies evidence, never the answer. The sparse set materializes
only those two subtrees, so `/tenant-incident/scenarios` never resolves. This
mirrors the harness's own per-sandbox skill self-heal.

**Do:** re-ensure reachability with the idempotent guard before each corpus read —
a no-op when both corpus roots resolve, a self-heal when a recycle has dropped it.
**Don't:** don't provision the corpus once at boot and treat it as durable — the
idle recycle drops the provisioned corpus while re-cloning the skills, so a
boot-once step reads an empty `/corpus` on a later turn.

**Do:** keep the sparse set scoped to `corpus/` plus `tenant-incident/corpus/`.
**Don't:** don't widen the sparse set to `tenant-incident/scenarios/` — pulling the
scenario into the agent's reach contaminates the diagnosis with the answer.

**Do:** let the round pin the corpus by registering the corpus skills at its
`corpus/v{k}` ref — the guard reads that ref from `AGENT_GIT_SKILLS` and clones the
corpus to match, so the record it reads is the one the frozen tag holds.
**Don't:** don't pin the clone to `main` — a frozen-tag round would then read the
moving head, and a baseline round and a later round would see one corpus, collapsing
the frozen delta the round exists to measure.

## The close-out is the pull request

A session does not end without the close-out, and the close-out is the session's
pull request — the record the next boot reads. The session files this pull request
whether or not it drafts a candidate; the dispositions and the closing attestation
are content enough, and the push is approval-gated.

**Do:** file the session's pull request even when no candidate is drafted — the
dispositions and closing attestation are a durable record on their own.
**Don't:** don't skip the pull request on a quiet session; an unfiled close-out is
state the next boot cannot recover.

## 1. Record dispositions

Read the consultation record the working session kept in the work product on the
branch — the entries it marked applied or considered as it worked (see the
`session` skill) — and into the pull request record one disposition for every
entry in it:

- **applied** — the entry bound the work and its payload was used.
- **considered-not-applicable** — the entry was consulted and set aside: its
  `not-this` matched, or its payload did not bind the work in hand.
- **fired-off-map** — the entry's hook matched a work shape the corpus does not
  cover; the fire surfaced a gap, and the observation is a promotion candidate.

**Do:** disposition every entry in the consultation record — the dispositions are
the telemetry the slow loop promotes from.
**Don't:** don't infer the consultation set from the diff; an entry consulted and
set aside leaves no trace there, so a set reconstructed from the diff silently
drops exactly the considered-not-applicable signal.

**Residue:** the dispositions are only as complete as the record the working
session kept. That the record is whole rests on the working session's discipline;
nothing here mechanically verifies a consultation was written down — a consultation
never recorded is dispositioned by neither the record nor the diff, and is lost
silently. This is a disclosed floor, not a guarantee (Article 8).

A **lens** is a guiding question paired with its counterfactual — an angle on the
work just done, and the challenge that keeps the angle's answer honest (see the
lens language in [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md)). Walk each lens
against the work in hand. An answer that survives its counterfactual is a candidate
observation, carried to step 3; an answer the counterfactual dissolves is recorded
as a considered disposition and filed no further.

| Lens | Angle | Counterfactual |
|---|---|---|
| missed-signal | What went unnoticed that a store could have surfaced? | What of it was truly unforeseeable — no rule, belief, or case could have caught it? |
| absent-authority | What rule or belief, had it existed, would have bound this work? | Why would that rule or belief not generalize — where would it misfire or over-reach? |
| falsifier-clash | Did the work contradict a belief's falsifier or a rule's `not-this`? | Is the clash the falsifier firing — the belief thereby falsified — or the work being wrong while the belief holds? |
| friction | Where was the work harder than the task warranted? | How much of that friction was irreducible, intrinsic to the problem rather than a missing entry? |
| better-path | What approach, in hindsight, would have reached the outcome for less? | What made the path taken reasonable given only what was known at the time? |
| first-error | What did the first attempt get wrong before it was corrected? | Which of those were mechanical slips, and which a missing piece of standing knowledge? |

**Do:** answer a lens only with its counterfactual answered too — the pair is the
lens, and the counterfactual is what filters slop from the slow loop's input.
**Don't:** don't file a lens answer whose counterfactual dissolves it; a candidate
that cannot survive its own challenge is noise the adjudicator must clear.

**Do:** walk every lens, even on a quiet session — a lens that surfaces nothing is
a considered disposition, not a skipped step.
**Don't:** don't narrow a lens to the incident's mechanics; the angle is the work
as it presented, not a single service or symptom.

## Write the run's close facts into the report frontmatter

Beyond the human-readable dispositions in the pull-request record, the close writes
the run's close facts into the YAML frontmatter of the diagnosis report — the same
report `grade.sh` scores and the multi-run round runner reads through
`parseReportMeta` in
[/tenant-incident/experiments/run-round-lib.ts](/tenant-incident/experiments/run-round-lib.ts).
`parseReportMeta` reads three fields off that frontmatter — `steps`, `disposition`,
and `forecast_hit` — and folds them into the delta ledger; the close owns the two
it does not already carry, named and spelled exactly as the runner reads them:

- **`disposition:`** — the observed disposition of the **entry under experiment**,
  one of `applied`, `considered-not-applicable`, or `fired-off-map` (verbatim,
  hyphenated as shown): the one corpus entry the round pre-registers this scenario to
  evaluate — the promoted rule, belief, or case whose behaviour the scenario's
  `expect` predicts — reported as *its* outcome. `applied` when that evaluated entry
  bound the diagnosis, `considered-not-applicable` when it was consulted and set
  aside, `fired-off-map` when the evaluated shape had no covering entry. This is one
  value, not the run's whole disposition set: a run consults many entries with mixed
  outcomes, each recorded per-entry in the pull-request record, but the frontmatter
  reports only the evaluated entry's, keyed on the entry the round names — never on
  "whichever entry bound the diagnosis." Keying on the diagnosis-binding entry would
  break a control scenario, where the evaluated entry is set aside while a different
  entry binds the diagnosis: the field would read `applied` and the runner would fold
  a false control violation into `false_fire`.
- **`forecast_hit:`** — a boolean scoring the run's **first** frozen forecast: `true`
  when the probe confirmed the diagnosis the run predicted before any probe ran,
  `false` when that first probe refuted it. An investigation may cycle — a refuted
  probe returns to recon and freezes another forecast (the `investigate` skill) — but
  this field scores only the first, the prediction registered before the corpus had
  been tested against the surface; a forecast fitted after a refutation is a
  corrected guess, and scoring it would measure persistence, not calibration. The
  cost of the extra cycles is already carried by `steps`. The first forecast is the
  one a promoted entry should move from miss to hit, so it is the one the delta reads.

    ---
    incident: <incident-id>
    steps: <n>
    disposition: considered-not-applicable
    forecast_hit: true
    ---

The field names and value spellings match the runner exactly: a `disposition:`
outside the three values above, or a non-boolean `forecast_hit:`, is read as absent,
and the run folds into the ledger with empty `applied`/`cna`/`fired_off_map`/
`forecast_hit` cells — the run's evidence dropped without a warning.

**Do:** write `disposition:` and `forecast_hit:` into the report frontmatter,
spelled exactly as the runner reads them.
**Don't:** don't leave them to be inferred from the report prose — the runner reads
the frontmatter only, and an undeclared close fact is a blank ledger cell, not a
derived one.

## 3. File candidates

A **candidate** is a draft entry filed through the `corpus-write` skill onto the
session's branch, riding this pull request; the human merge admits it. A diagnosed
incident's close deposits into two stores that are not interchanged:

- **The incident case** — the record of the occurrence the session diagnosed: its
  symptom, the probe frozen before the fix, the root cause, and the learning the
  class carries forward. It is an incident case entry in the tenant case ledger
  `tenant-incident/corpus/incidents/`, built against that store's
  [SCHEMA.md](/tenant-incident/corpus/incidents/SCHEMA.md) as the occurrence's dated
  record — frozen at admission, keyed by the `class` and `surface` the incident
  presented at, never raised into a standing constraint. This is the deposit the
  learning delta reads across incident N and incident N+k of one class (Article 12).
  A diagnosed incident deposits its case whether or not a retro lens surfaced a
  promotion candidate — the case records the occurrence, not a promotion, so a quiet
  close still owes the case of the incident it diagnosed. It is tenant knowledge and
  lands only in the tenant store.
- **The constraints the case nominates** — a rule, belief, or decision the case
  argues for, each a separate candidate in its own layer store. These are the
  promotion candidates the retro lenses and fired-off-map dispositions surface, and
  an incident may nominate none. The case names each nomination in its own `related`;
  the nominated entry anchors back to the case per its store's SCHEMA — a decision
  through its `recurrences`, a rule or belief through the anchors its warrant carries.
  The case holds the evidence; the nominated entry holds the constraint; they are
  distinct entries wired by that citation, so correcting one never forks the other.

Each candidate takes its target store's own shape (the five-slot contract for the
entry stores; the term block for `vocabulary/`). The close-out drafts it through
`corpus-write`, handing it the incident's id and class and naming the target store,
so the signed deposit commit places the entry in the learning arc and its
`Corpus-Store` marker points at where the entry lands. The incident's id is the case
id the close reserves — `INC-nnnn` — so the case entry, the deposit's `Incident-Id`,
and the deposit branch all key on one id. `corpus-write` is a skill loaded by name —
the harness materializes it at `/opt/tf/skills/corpus-write/`, alongside the other
loaded skills — not a helper file under `/corpus`; load the skill, and do not search
the corpus tree for it. Admission — the human merge — admits it: a store that mints
its id at admission gains it then, a store that reserves its id at draft (the
incident case ledger, the build ADR store) has carried it since filing, and a
`vocabulary/` term is admitted as an id-less block, keyed by the term itself.

The signed corpus deposit is a distinct write from any operational service fix the
remediation lands (the `implement` skill, ADR-0018): a service fix carries no
`Incident-*` signature, so it stays out of the learning delta the case deposit is
read for.

**Do:** deposit the incident case for any incident the session diagnosed, even when
no promotion candidate survives the retro lenses.
**Don't:** don't treat the case as optional on a quiet close — the case records the
occurrence the delta reads, and a diagnosed incident with no ledger entry is a hole
in its class's history.

**Do:** deposit the incident's learning as a case in
`tenant-incident/corpus/incidents/`, built against that store's SCHEMA.
**Don't:** don't deposit it as a decision in the layer decision store — an incident
case is tenant knowledge and a dated occurrence, not a standing layer constraint,
and incident knowledge in the layer breaches the layer/tenant separation (Article 7).

**Do:** file a constraint the case nominates as its own candidate in its own store,
citing the case as the anchor.
**Don't:** don't fold a nominated constraint into the case or restate the case's
evidence inside the constraint — the two are wired by citation, and duplication
forks when one is corrected.

**Do:** give every candidate the target store's five-slot shape through
`corpus-write` — the payload and its latch fan, anchored to git-reachable evidence.
**Don't:** don't file a bare observation as a candidate; an entry with unserviced
slots is a gap the slow loop cannot adjudicate.

**Do:** hand `corpus-write` the incident's id and class, so the deposit commit is
signed and groups with the other incidents of its class.
**Don't:** don't leave the incident coordinates off the deposit — a deposit that
cannot be grouped and ordered by class is invisible to the learning-delta read-out.

**Do:** file every candidate as a draft on the branch and let the human merge admit
it.
**Don't:** don't write to a permanent store directly — the merge is the only
admitting write.

**Do:** keep the signed corpus deposit and the operational service fix distinct
writes.
**Don't:** don't sign a service fix with the `Incident-*` deposit markers — an
unsigned service fix stays out of the learning delta (ADR-0018), and a signed one
pollutes the class read-out with a change that carries no learning.

## 4. Walk the closing latches

Poll each row of `corpus/latches/closing.md` against the work in hand, discharge
the owed act of every row that fires, and leave the walk's `latch-walk:` line in
the pull request (format and cautions:
[/corpus/latches/README.md](/corpus/latches/README.md)).

**Do:** poll every row against the work in hand, even a table that rarely fires.
**Don't:** don't skim a table because it holds few rows — a rarely-firing row can
be the one that matters, and skimming is a silent miss.
