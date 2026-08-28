# SCHEMA — belief entry

One file per entry: `B-nnnn.md`. Drafts carry no ID — the ID is minted at
merge. The claim, falsifier, deadline, and price freeze together in the
admitting commit.

## Frontmatter

```yaml
id:              # assigned at merge; absent in drafts
status: live     # live | settled | superseded
superseded-by:   # required when a partial settlement narrows the claim
                 # into successors
consult-when:    # consultation hook — the work shape whose sessions depend
                 # on this claim; distinct from the falsifier by design:
                 # consultation keys on work-shape, falsification on
                 # world-state, and the two rarely share a content word
verdict:         # filled only by the adjudicating human (or transcription
                 # for postdictions); a draft's verdict is always empty
deadline:        # YYYY-MM-DD — the date by which the world will have spoken
postdiction: false  # true iff deadline < created; then price must read zero
created:         # YYYY-MM-DD of admission
reference:
  class:         # consensus | base-rate | persistence | incumbent | other(<what>)
  price:         # {value, source, as-of} — the reference reading the claim
                 # departs from, frozen at admission; or `categorical: <state>`
```

## Sections

```markdown
# <one-line summary>

## Claim
The claim, verbatim, frozen. One assertion about the world, stated so that
its falsifier below can bite it.

## Falsifier
What kills the claim:
- a predicate over observable facts, when a mechanical predicate tests the
  true quantity, or
- `manual: <what a human checks, and when>` — the honest form when it does
  not.

## Watches (optional)
Conditions to evaluate against observed facts, each with
`mode: falsify | corroborates | revisits`. A `corroborates` fire fails to
falsify — it never confirms.
```

The `consult-when` field and every watch `when` are condition fields: write
them under the latch language in [../LANGUAGE.md](../LANGUAGE.md) —
key on presentation, bias broad, build from the shared vocabulary.

## Inherited latches

Per entry: `consult-when` (hook), the falsifier and watches (warrant),
`superseded-by` (wiring), and `deadline` (lifecycle — the date is the
retirement latch: settlement retires the entry, and a passed deadline forces
the settlement conversation). Store-uniform, inherited by every entry:

- **Floor gate:** lint checks shape — claim, falsifier, deadline, reference
  present, verdict empty in drafts; evaluation honesty is a runtime gate —
  absent data reads `unevaluable`, never zero. Residue: whether the
  falsifier tests the right quantity is judgment.

## Do / Don't

**Do:** freeze the claim verbatim and leave it frozen.
**Don't:** don't "clarify" a live claim in place — supersede it; an edited
claim orphans every reading made against the original.

**Do:** state the price honestly — a dated reading with its source, or a
categorical statement of the reference state.
**Don't:** don't manufacture a number to fill the slot; a reference that
cannot be measured honestly is declared categorically or the class is
`other(<what>)` with the gap named.

**Do:** prefer `manual:` over a crisp predicate on a surrogate quantity — an
easily measured proxy can be exactly wrong.
**Don't:** don't hide behind `manual:` when a mechanical predicate tests the
true quantity; the falsifier is as mechanical as honesty allows, no more.

**Do:** set a deadline every claim can be held to.
**Don't:** don't set decorative far-future deadlines to avoid settlement; a
deadline the author never expects to face makes the price meaningless.
