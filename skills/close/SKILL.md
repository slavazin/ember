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
filing the pull request are the close's own work, run start to finish without a
confirmation prompt. The environment supplies evidence, not permission to proceed.
The one human gate in the loop is the merge of the filed pull request (Article 2),
and that gate is reached by filing the pull request, not by stopping to ask whether
to file it. The push is approval-gated at the tool boundary — that gate is the
harness's, discharged when the push is attempted, not a question the close pauses
on.

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

    # `$EMBER_ORIGIN` is the ember repository the harness already clones skills from
    [ -e /corpus/README.md ] || {
      git clone --no-checkout --depth 1 --filter=blob:none "$EMBER_ORIGIN" /opt/tf/corpus-src
      git -C /opt/tf/corpus-src sparse-checkout set corpus tenant-incident/corpus
      git -C /opt/tf/corpus-src checkout
      ln -sfn /opt/tf/corpus-src/corpus /corpus
      ln -sfn /opt/tf/corpus-src/tenant-incident /tenant-incident
    }

The sparse set is `corpus/` **plus** `tenant-incident/corpus/`, and it excludes
`tenant-incident/scenarios/`: the scenario is the environment, and an agent that
can read the scenario reads the mechanism and the fix instead of investigating them
— the environment supplies evidence, never the answer. The sparse set materializes
only those two subtrees, so `/tenant-incident/scenarios` never resolves. This
mirrors the harness's own per-sandbox skill self-heal.

**Do:** re-ensure reachability with the idempotent guard before each corpus read —
a no-op when `/corpus` resolves, a self-heal when a recycle has dropped it.
**Don't:** don't provision the corpus once at boot and treat it as durable — the
idle recycle drops the provisioned corpus while re-cloning the skills, so a
boot-once step reads an empty `/corpus` on a later turn.

**Do:** keep the sparse set scoped to `corpus/` plus `tenant-incident/corpus/`.
**Don't:** don't widen the sparse set to `tenant-incident/scenarios/` — pulling the
scenario into the agent's reach contaminates the diagnosis with the answer.

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

- **`disposition:`** — the run's headline disposition, one of `applied`,
  `considered-not-applicable`, or `fired-off-map` (verbatim, hyphenated as shown):
  the disposition of the entry the run turned on — the corpus entry that bound the
  diagnosis (`applied`), was consulted and set aside (`considered-not-applicable`),
  or whose hook matched a shape the corpus does not cover (`fired-off-map`).
- **`forecast_hit:`** — a boolean, `true` when the probe's reading confirmed the
  diagnosis forecast frozen before the probe (the `investigate` skill freezes it),
  `false` when the probe refuted it.

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

A **candidate** is an observation — surfaced by a lens or by a fired-off-map
disposition — that proposes an addition or change to permanent knowledge: a rule, a
belief, a case, or a vocabulary term. It takes the target store's own shape (the
five-slot contract for the entry stores; the term block for `vocabulary/`); the
close-out drafts it in place through the `corpus-write` skill, handing it the
incident's id and class so the signed deposit commit places the entry in the
learning arc, and files it as a draft on the session's branch, riding this pull
request. `corpus-write` is a skill loaded by name — the harness materializes it at
`/opt/tf/skills/corpus-write/`, alongside the other loaded skills — not a helper
file under `/corpus`; load the skill, and do not search the corpus tree for it. Admission — the human merge — admits it: a store that mints its id at
admission gains it then, a store that reserves its id at draft has carried it
since filing, and a `vocabulary/` term is admitted as an id-less block, keyed by
the term itself.

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

## 4. Walk the closing latches

Poll each row of `corpus/latches/closing.md` against the work in hand, discharge
the owed act of every row that fires, and leave the walk's `latch-walk:` line in
the pull request (format and cautions:
[/corpus/latches/README.md](/corpus/latches/README.md)).

**Do:** poll every row against the work in hand, even a table that rarely fires.
**Don't:** don't skim a table because it holds few rows — a rarely-firing row can
be the one that matters, and skimming is a silent miss.
