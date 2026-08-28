# SCHEMA — rule entry

One file per entry: `R-nnnn.md`. Drafts carry no ID — the ID is minted at
merge. Frontmatter and body are a register: corrected in place as evidence
accumulates, with the warrant staying in the cited decisions.

## Frontmatter

```yaml
id:            # assigned at merge; absent in drafts
status: active # active | demoted
fires-when:    # the work shape that routes this rule to a session —
               # as broad as is predictive
not-this:      # mandatory — shapes fires-when matches where the duty does
               # NOT bind; each names an observed or concretely predicted
               # misfire
warrant: []    # ≥ 2 decision IDs, from distinct surfaces; the surfaces are
               # named in those decisions' `surfaces:` field
floor:         # what mechanically enforces part of the duty — a gate or
               # check by name — or `none`; floor plus residue cover the duty
residue:       # mandatory — what enforcement of this rule does not check
moot-when:     # retirement condition — the event under which the fired-on
               # shape stops occurring; coverage migration is the other exit
```

## Body

```markdown
# <one-line recognition summary>

## Duty
One sentence: <condition> → <obligation>. Imperative, object-decoupled, and
as narrow as is true.
```

The `fires-when` and `not-this` fields are condition fields: write them
under the latch language in [../LANGUAGE.md](../LANGUAGE.md) — key on
presentation, bias broad, build from the shared vocabulary.

## Inherited latches

Per entry: `fires-when`/`not-this` (hook), `floor` (enforcement), and
`moot-when` (lifecycle). Store-uniform, inherited by every entry:

- **Revisit trigger:** carried through the warrant — a rule holds no
  world-facing premises of its own; the why lives in the cited decisions,
  and their triggers are this rule's triggers.
- **Wiring edges:** `warrant:` — a cited decision flipping status
  (superseded, moot) re-opens this rule for review; the check on a warrant
  flip is mechanical, the disposition human.

## Do / Don't

**Do:** hook broad, duty narrow — `fires-when` as wide as it predicts, the
Duty no wider than the warrant supports.
**Don't:** don't widen the duty to match the hook; a hook that fires on
shapes the duty does not cover is handled by `not-this`, not by inflating
the obligation.

**Do:** carry the *why* by citing the warrant decisions.
**Don't:** don't restate their rationale in the rule — a restated why is a
second copy that drifts; the rule owns only the when-and-what.

**Do:** fill `not-this` with the real misfires — the shapes a reasonable
router would wrongly match.
**Don't:** don't pad it with imaginary exclusions to look rigorous; each
line must trace to an observed or concretely predicted case, and an empty
`not-this` on a young rule is honest, not deficient.

**Do:** state `residue` plainly — what a session can still get wrong with
this rule fully enforced.
**Don't:** don't write reassurance there; the residue field is disclosure of
a gap, and "none" is almost never true.
