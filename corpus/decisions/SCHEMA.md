# SCHEMA — decision entry

One file per entry: `D-nnnn.md`. Drafts carry no ID — the ID is minted at
merge. Everything below the frontmatter is frozen at admission; later change
means superseding.

## Frontmatter

```yaml
id:            # assigned at merge; absent in drafts
status: active # active | superseded | moot  — the only field ever flipped
superseded-by: # required when status: superseded
surfaces: []   # the distinct surfaces this decision was observed to bind on
moot-when:     # retirement condition — the nameable event under which the
               # decided fork itself stops existing
created:       # YYYY-MM-DD of admission
```

## Sections

```markdown
# <one-line summary>
One line. It routes a reader to this entry; it must not be obeyable on its
own — a reader who acts on the summary without opening the entry is acting
without the warrant.

## Decision
The constraint on future work. Present tense. Every sentence is a premise
that holds until an item below falsifies it — nothing else is admitted here.

## Warrant
The falsification list. Each item either:
- `False if: <nameable event>` — with anchors, or
- a dated fact: `<measurement> (as of YYYY-MM-DD, <anchor>)`.

## Revisit
Zero or more triggers: `{when: <world condition>, then: <owed act>,
settled: }` — `settled` stays empty while live and is filled in the same
commit as the change that settles it.
```

## Inherited latches

Per entry: the revisit triggers (warrant), `moot-when` (lifecycle), and
`superseded-by` (wiring, on retirement). Store-uniform, inherited by every
entry:

- **Hook:** the summary line, full-scanned at plan time — decisions carry no
  routed `fires-when`; cheap summaries make the scan the router.
- **Wiring edges, inbound:** every rule citing this entry in `warrant:`;
  the edge lives on the rule and the reverse view is derivable, never
  hand-listed here.
- **Floor gate:** lint checks shape — the five slots present, no duty
  language in the body. Residue: content is deliberately judgment.

## Do / Don't

**Do:** write the Decision as pure constraint-and-trigger — only sentences
that are true until falsified.
**Don't:** don't carry tangential detail (tool versions, counts, directory
listings, org facts) in the Decision; when the tangent rots the entry reads
false while its premise stands. Anything worth keeping is dated and moved to
the Warrant.

**Do:** raise abstraction — state the constraint decoupled from the objects
it was learned on ("errors that wrap must carry their cause", not "fix the
ingest path").
**Don't:** don't abstract past the evidence; the falsification list must
still be able to bite the abstracted claim.

**Do:** cite this entry from rules that operationalize it.
**Don't:** don't write duty language here — no `fires-when`, no "always/never
do" addressed at future work moments. A decision constrains; a rule fires.
Duty language in a decision body is a lint failure.

**Do:** keep the Warrant a list of falsifiers and dated facts.
**Don't:** don't narrate the deliberation. Options weighed and paths not
taken enter only as falsifiers ("False if: <the rejected premise> turns out
to hold"), or not at all.
