# SCHEMA — incident case entry

One file per entry: `INC-nnnn.md` (four digits, reserve-once, gap-tolerant).
An entry's id is reserved when its case is drafted at close-out, canonical
`INC-nnnn`, and equal to the filename `<id>.md`; the merge is the admission
that adjudicates it. Everything below the frontmatter is frozen at admission;
later change means superseding, never editing.

## Why a case ledger, not a decision record

An incident case is a ledger entry, not a decision entry, and the difference is
load-bearing. A decision (see [/corpus/decisions/SCHEMA.md](/corpus/decisions/SCHEMA.md))
is a constraint on future work whose live question is "is this still correct?" —
a standing premise held true until a warrant falsifies it. An incident case is
a dated record of one occurrence whose live question is "what happened, and what
did the class learn?" — evidence frozen at close, never re-adjudicated for
correctness. Forcing an incident into a decision conflates two things the store
seam keeps apart: the **evidence** (this case) and the **constraint** it may
nominate (a rule, belief, or decision in that store). A case is the anchor a
promoted rule cites in its warrant; the constraint is a separate entry that
outlives the case. Recording the occurrence as its own frozen ledger entry is
what lets the slow loop read a class's cases in order and measure the
learning delta — incident N against incident N+k — without mutating the record
each reading depends on.

## Frontmatter

```yaml
id:               # INC-nnnn — reserved when the case is drafted, canonical, equal to the filename
status: closed    # closed | superseded | moot — the only field flipped after admission
class:            # the incident class this case belongs to — the family the learning
                  # delta groups and orders by; a tenant vocabulary term, never coined here
surface:          # the estate surface the incident bound (a service, a store, a workflow)
forecast-outcome: # hit | miss | unevaluable — whether the probe made before the fix held.
                  # unevaluable when the world did not speak; never silently a miss.
                  # This is the corpus-side reading the run report carries as forecast_hit.
disposition:      # applied | considered-not-applicable — whether the case's remediation
                  # bound the fix. The corpus-side reading the run report carries as disposition.
superseded-by:    # required when status: superseded — the successor INC-nnnn
related: []       # optional cross-refs (canonical ids): prior incident cases of the same
                  # class, and the rule / belief / decision candidates this case nominated
occurred:         # YYYY-MM-DD the incident occurred
closed:           # YYYY-MM-DD of admission — the close-out date
```

`superseded-by` is set in the same change that flips the superseded case's
status; a `moot` case carries no successor.

## Sections

```markdown
# <one-line summary — what failed and what the class learned>
One line. It routes a reader to this case; it must not be actionable on its own —
a reader who acts on the summary without opening the case acts without the evidence.

## Incident
What presented and its impact, as dated facts keyed to the surface. The symptom as
it arrived at diagnosis — not the mechanism, which the reader does not yet hold.

## Forecast
The probe made before the remediation committed (Constitution Art. 5, probe before
commit) and the observed result, as dated facts. The frontmatter forecast-outcome
carries the verdict; this section states the prediction the probe tested and what
the world returned.

## Root cause
The mechanism, stated once and anchored to git-reachable evidence — the reproduction,
the fix, the logs. Present the cause, not the search that found it.

## Learning
What the next incident of this class should reach for sooner, and the candidate
entries this case nominated by id. This is the anchor a promoted rule or belief
cites back; write it so that citation still bites.

## Evidence
The anchor list grounding every claim above: pull requests, commits, and repository
files. Each a git-reachable reference; inward planning material is never an anchor.
```

The `class` and `surface` fields are hooks: write them under the latch language
in [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) — key on how the incident presents
at diagnosis, bias broad, and build from the shared vocabulary.

## Inherited latches

Per entry: `class` and `surface` (hook), the Evidence anchors and
`forecast-outcome` (warrant), `related` and `superseded-by` (wiring, on
retirement), and the retirement condition (a re-adjudication, or the class going
moot). Store-uniform, inherited by every entry:

- **Hook:** the summary line plus the `class` grouping, scanned at diagnosis
  time. A session whose incident matches a case's class is routed to the case
  by these, not by re-reading every entry.
- **Wiring edges, inbound:** every entry naming this case in `related` — a later
  case of the same class, or a rule, belief, or decision whose warrant cites this
  case as one of its recurrences. The reverse view is derived, never hand-listed.
- **Floor gate:** two mechanical checks, split the way the build ADR store's are.
  Byte-immutability holds from admission: the corpus-lint frozen-path check
  freezes every admitted `INC-nnnn.md` against the merge-base — the body and
  every frontmatter line except `status` and `superseded-by` — so a closed case
  is superseded, never edited or deleted in place. Shape validation — id
  canonical and equal to the filename, the `status`, `forecast-outcome`, and
  `disposition` vocabularies honoured, the supersession pointer reciprocal, and
  the required sections present — is owned by the store's own validator, wired
  when the incident loop mints the first case; this SCHEMA is the contract that
  validator enforces, and the store stays empty-but-valid until then. Residue:
  no check reads whether the root cause is true, an anchor supports its claim, or
  the learning generalizes — that stays human review.

## Do / Don't

**Do:** freeze the case at close and leave it frozen — the record is evidence a
later case reasons from.
**Don't:** don't edit a closed case to correct its diagnosis; a re-adjudication
supersedes it, and overwriting destroys the record the delta read depends on.

**Do:** set `class` from the tenant vocabulary so cases of one family group and
order together.
**Don't:** don't coin a class name inside the entry; an ad-hoc class splits a
family the delta read must see whole — name it into the vocabulary first, then use it.

**Do:** record `forecast-outcome` honestly, marking `unevaluable` when the world
did not speak.
**Don't:** don't score an unmeasured forecast as a miss to fill the slot; a
manufactured verdict makes the class's forecast record meaningless.

**Do:** anchor every claim to a git-reachable outward reference in Evidence.
**Don't:** don't anchor to `planning/` or narrate the diagnosis; an inward path
resolves nowhere, and process narration is not evidence.

**Do:** name in `related` the candidate entries this case nominated, so the case
and its promoted learning stay wired across stores.
**Don't:** don't restate a nominated rule's duty inside the case; the case holds
the evidence, the rule holds the constraint, and duplication forks when one is
corrected.

## Worked skeleton

```markdown
---
id: INC-0007
status: closed
class: <the incident family, a tenant vocabulary term>
surface: <the service, store, or workflow the incident bound>
forecast-outcome: hit
disposition: applied
related: [INC-0004]
occurred: 2026-08-27
closed: 2026-08-29
---
# <one-line summary — what failed and what the class learned>

## Incident
The symptom as it presented at diagnosis, with its impact, dated (observed
YYYY-MM-DD, <anchor>).

## Forecast
The probe run before the fix committed and its predicted signature, and the
observed result (observed YYYY-MM-DD, <anchor>).

## Root cause
The mechanism, anchored to the reproduction and the fix.

## Learning
What a later incident of this class should reach for sooner, and the candidate
entries this case nominated by id.

## Evidence
- PR #<n> — the fix.
- <repository path> — the reproduction or fixture.
```
