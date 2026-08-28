---
name: promotion-review
description: The slow-loop route-before-mint ladder and graded bars the human runs to promote accumulated observations into decisions, rules, and beliefs.
---

# promotion-review — the slow loop

The human-run pass that promotes accumulated observations into permanent entries.
The agent drafts and examines; the human routes, adjudicates, and merges. No
promotion happens without a human merge.

## Route before mint

Before minting an entry, route the observation to an entry that already covers
it: a status flip, a superseding successor, or a citation from a rule. Minting is
the last resort, not the first.

**Do:** search the target store for an entry the observation extends before
drafting one.
**Don't:** don't mint a duplicate — two entries for one judgment fork the moment
one is corrected.

## The graded bars

Most knowledge earns its tier by recurrence, and each tier has a bar:

- **Candidate draft** — one anchored observation. Lives on a branch, the
  pre-admission tier; discardable without trace.
- **Decision** — at least two anchored recurrences of the same shape, each tied
  to the surface it was observed on. Admits one case in `corpus/decisions/`.
- **Rule** — at least two decisions whose surfaces are distinct, plus the human
  merge. The most gated bar: a duty generalized from a single surface is a guess
  wearing a rule's authority (see [/corpus/rules/README.md](/corpus/rules/README.md)).
- **Mechanization** — two silent failures of a duty already carried by a rule.
  The mechanical part becomes a floor gate; the rule's residue is disclosed anew.

A **belief** is the exception: recurrence is not its bar. A world-facing claim
admits on a declared falsifier, a deadline, and a reference price, plus the human
merge — so a single novel hypothesis is admissible (see
[/corpus/beliefs/README.md](/corpus/beliefs/README.md)).

**Do:** hold each recurrence-tiered promotion to its count, read from the
entries' anchors, and admit a belief on its falsifier, deadline, and price.
**Don't:** don't promote a decision or rule on a single instance — one occurrence
is at most a draft — and don't force a recurrence count onto a belief, whose bar
is a stated falsifier, not repetition.

## The slot signature

Route an observation by which contract slot it recurs in:

| The observation recurs as… | It promotes toward… |
|---|---|
| a constraint on a fork, settled by adjudication | a **decision** |
| a duty owed whenever a work shape recurs | a **rule** |
| a dependence on a world-facing claim that could be falsified | a **belief** |

**Do:** match the observation to the slot it actually recurs in before choosing a
store.
**Don't:** don't file a world-claim as a decision or a duty as a belief — a
mis-slotted entry latches on the wrong hook and never fires when it is needed.

## Drafting and examination

Promotion drafts go through the `corpus-write` skill: a proposer drafts, an
examiner attacks, the pull request carries both, and the human's merge fills the
verdict and admits the entry.
