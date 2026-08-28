# SCHEMA — build ADR entry

One file per entry: `ADR-nnnn.md` (four digits, reserve-once, gap-tolerant).
Drafts carry no id — the id is minted at merge, and the filename equals `<id>.md`.
Everything below the frontmatter is frozen at admission; later change means
superseding, never editing.

## Frontmatter

```yaml
id:              # ADR-nnnn — assigned at merge; absent in drafts
status: accepted # accepted | superseded | moot | converged  — the only field flipped
supersedes:      # the ADR-nnnn this replaces; set in the same change that flips the old entry
superseded-by:   # required when status: superseded — the successor's id
converged-into:  # required when status: converged — the id(s) that absorbed this decision
promoted-to:     # optional — the CONSTITUTION.md article a load-bearing ADR was lifted into
scopes: []       # coarse, stable path prefixes this decision governs; the diff-time arm keys
                 # on them. Package or directory granularity — never a file:line. Opt-in:
                 # a pure-process ADR that governs no path declares none.
related: []      # optional cross-refs to other ADR ids (canonical form); pull-request and
                 # commit anchors belong in the Warrant, not here — this list feeds the
                 # lineage graph, which resolves ids
backfilled:      # optional true — a decision reconstructed from history rather than decided live
decided:         # YYYY-MM-DD of admission
```

`supersedes` and `superseded-by` are a reciprocal pair: the successor names the
entry it replaces, and that entry flips to `status: superseded` and names the
successor back, in one change. A `moot` entry carries no successor; a `converged`
entry names its absorbers in `converged-into`.

## Sections

```markdown
# <one-line decision — the constraint, not the deliberation>
One line. It routes a reader to this entry; it must not be obeyable on its own — a
reader who acts on the summary without opening the entry is acting without the warrant.

## Context
The forces at play: what made this a fork worth deciding. Present tense where a force
still holds; a dated fact where it was a measurement.

## Options considered
Two or more options, each with its shape and the verdict against it. Omit this section
only when the decision was genuinely uncontested — the absence itself signals no
alternative was weighed.

## Decision
The constraint on future build work. Present tense. Every sentence is a premise that
holds until an item in the warrant falsifies it.

## Consequences
What the decision enables and what it forecloses.

## Warrant
The falsification list. Each item either:
- `False if: <nameable event>` — with a git-reachable anchor, or
- a dated fact: `<measurement> (as of YYYY-MM-DD, <anchor>)`.
Optionally, revisit triggers `{when: <world condition>, then: <owed act>, settled: }` —
`settled` stays empty while live and is filled in the same commit that settles it.
```

## Anchors

Every claim anchors to a **git-reachable reference that ships in the repository**: a
pull request (`PR #5`), a commit, or a layer or tenant file. The inward planning
material (`planning/`) is gitignored — absent from the repository — so it is never a
valid anchor; name the outward artifact the decision produced instead.

## Inherited latches

Per entry: the revisit triggers and falsifiers (warrant), `scopes:` (the diff-time
hook), and `superseded-by` / `converged-into` (wiring, on retirement). Store-uniform,
inherited by every entry:

- **Hook:** the summary line, scanned at plan time (`adr index`), plus the `scopes:`
  prefixes matched at diff time (`adr scopes`). A decision that governs a path declares
  it; one that governs none is reached by summary alone.
- **Wiring edges, inbound:** every ADR naming this entry in `supersedes`,
  `converged-into`, or `related`; the reverse view is derived by `adr related`, never
  hand-listed here.
- **Floor gate:** `adr check` validates shape — id canonical and equal to the filename,
  status in its set, every present scalar field a scalar (a list where a pointer belongs
  fails, never silently drops the edge), the supersession pair reciprocal, `scopes`/`related`
  well-formed, and the required body sections (Context, Decision, Consequences, Warrant)
  present. Residue: it does not check that the Decision is true, that an anchor supports its
  claim, that a section says anything, or that a `scopes` prefix is the right one.

## Do / Don't

**Do:** write the Decision as pure constraint-and-trigger — only sentences that hold
until the warrant falsifies them.
**Don't:** don't carry tangential detail (tool versions, counts, directory listings) in
the Decision; when the tangent rots the entry reads false while its premise stands.
Anything worth keeping is dated and moved to the Warrant.

**Do:** raise abstraction — state the constraint decoupled from the one surface it was
learned on, so it binds the next occurrence too.
**Don't:** don't abstract past the evidence; the warrant must still be able to bite the
abstracted claim.

**Do:** declare `scopes:` at package or directory granularity, broad enough that a
session editing the governed surface is shown the decision.
**Don't:** don't declare a `file:line` scope or an over-narrow path; the surface moves,
the decision outlives it, and an over-narrow scope misses the next edit. Under-declaring
is the safe failure — omit `scopes` rather than guess a path.

**Do:** anchor every claim to a git-reachable outward reference.
**Don't:** don't anchor to `planning/` or narrate the deliberation; an inward path
resolves nowhere, and process narration is not a warrant.

**Do:** supersede a reversed decision — a successor ADR that names the prior one, and the
prior one flipped to `superseded` with a pointer back.
**Don't:** don't edit a frozen entry to correct its design; the reversed decision is
evidence, and overwriting it destroys the record the store exists to keep.

## Worked skeleton

```markdown
---
id:
status: accepted
scopes: [tools/]
related: []
decided: 2026-08-28
---
# The corpus derivation scripts run on Node 22 through tsx, with no build step

## Context
The layer's tooling is a handful of TypeScript files read by the same repository that
hosts the corpus. A compile-and-emit step would put a generated artifact between the
source and its reader.

## Options considered
### Option A — compile to JavaScript, run the emitted files
Shape: a `dist/` build gate before every run. Verdict: rejected — a build artifact the
reader must trust over the source.
### Option B — run the TypeScript directly under tsx
Shape: `node --import tsx tools/<file>.ts`. Verdict: chosen — the source is the artifact.

## Decision
The corpus tooling runs directly under tsx on Node 22; there is no compile-and-emit
step, and the checked-in TypeScript is the only artifact a reader trusts.

## Consequences
Enables editing a tool and re-running it in one step. Forecloses shipping a compiled
binary without adding a build gate first.

## Warrant
- `engines.node` is `>=22` (as of 2026-08-28, package.json).
- False if: a runtime the corpus must support cannot execute TypeScript through a loader.
```
