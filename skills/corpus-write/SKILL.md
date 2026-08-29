---
name: corpus-write
description: The proposal procedure for filing a candidate entry — five-slot contract, anchored evidence, examiner dispatch, and pull-request etiquette. Open when a session has a candidate to propose.
---

# corpus-write — the proposal procedure

How a session turns an observation into a candidate entry and files it for
admission. Every permanent entry enters through this procedure; no session writes
to a store directly.

## The five-slot contract

An entry fills all five contract slots — the payload and its latch fan (hook,
revisit trigger, wiring edge, floor gate, retirement condition), one per slot
(see [/corpus/README.md](/corpus/README.md) and the target store's `SCHEMA.md`).
A slot left unserviced is a slot nothing will ever route, revisit, or retire.

**Do:** fill or inherit every one of the five slots against the store's SCHEMA.
**Don't:** don't leave a slot empty to be filled by someone downstream — an
unserviced slot ships as a silent gap, not a note to return to.

**Do:** anchor every claim in the entry to a git-reachable reference.
**Don't:** don't carry an unanchored assertion — a claim with no anchor is
narration, and its warrant cannot bite it.

## Drafting

The filing agent drafts the entry itself. It already holds the observation and
its anchors, so handing them to a separate drafting subagent would re-freeze the
same context without adding a perspective — a subagent earns its dispatch by
holding a view the root does not (the examiner's, the recon shape's), and the
drafter's view is the root's own. Fill the five slots above against the target
store's `SCHEMA.md`, and:

- Raise the abstraction to the constraint the evidence supports — state the
  judgment decoupled from the objects it was learned on, and no further than the
  anchors can still falsify.
- Leave the id empty; admission mints it at merge.

**Do:** raise the abstraction as far as the anchors can still bite.
**Don't:** don't abstract past the evidence — a claim the anchors cannot falsify
is a slogan, not an entry.

## Examination

Spawn an **examiner** subagent, pasting [/roles/examiner.md](/roles/examiner.md)
verbatim, followed by the draft entry's text frozen and unaltered
(freeze-the-target). The examiner attacks the draft and returns a verdict-pending
record; it never writes, and holds no stake in the entry's admission.

**Do:** freeze the target — append the draft's exact text to the examiner
dispatch.
**Don't:** don't summarize or edit the draft before handing it over; the examiner
must attack the entry as it would be admitted, not a cleaned copy.

**Do:** file the examiner's record into the same pull request as the draft, its
verdict field empty.
**Don't:** don't fill the verdict — the verdict is the human's, written at merge.

## Filing

File the draft and the examiner record on the session's branch and push; the push
is approval-gated. The pull request carries the draft, the examiner record, and
the evidence; its merge is the durable human gate that admits the entry and mints
its id.

**Do:** file candidates on a branch and open a pull request.
**Don't:** don't push to the main line — a direct write bypasses the gate the
whole procedure exists to serve.
