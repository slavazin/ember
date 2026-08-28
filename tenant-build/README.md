# tenant-build — the build's own corpus

A tenant of the Quartermaster layer whose domain is **this repository's own
construction**. Where `tenant-incident/` is the showcase guest (an incident
responder), `tenant-build` is the layer run on the hand that builds it: the
architecture and process decisions of the entry itself, governed by an instance of
the layer's own decision-store pattern.

**Why it exists.** Build decisions were scattered through session prose and
re-litigated across sessions — the tenant seam reopened more than once, the
constitution's article count resolved twice, the trace-store question re-answered.
A flat, greppable, supersedable decision register at the tier below the build's
constitution and above its session chronology ends the re-litigation: a decided
fork is recorded once, superseded when it changes, and surfaced when a session
touches the surface it governs.

**What it holds.** One store today: [`corpus/decisions/`](corpus/decisions/README.md) —
architecture-decision records (`ADR-nnnn`). The store is a **second instance** of the
layer's `corpus/decisions/` pattern, not new machinery; it imports the schema shape
and declines the incident tenant's admission ceremony (a build ADR admits on one
adjudicated fork, not two recurrences).

**The seam holds both ways.** As a tenant, `tenant-build` references the layer freely
(its ADRs name `corpus-lint`, `index-gen`, the seam) — that is a tenant→layer
reference, always allowed. It carries no domain join-key vocabulary of its own, so it
does not participate in the layer/tenant seam scan as a domain tenant does.

**Anchors are outward.** Every claim in an ADR anchors to a git-reachable reference
that ships in the repository — a pull request, a commit, a layer or tenant file. The
inward planning material (`planning/`, gitignored) is not a valid anchor: it is absent
from the repository, so a reference to it would resolve nowhere.

## Tooling

The store is read and checked through [`tools/adr.ts`](tools/adr.ts) — an on-demand
projector (no committed index), run through the repository's existing `tsx` toolchain:

- `npm run adr index` — the plan-time recall: one line per ADR (`id · status · scopes ·
  summary`), filterable by `--status`, `--scope`, `--related`. Summaries route; they are
  never obeyable on their own.
- `npm run adr related <id>` — the lineage graph for one ADR: its supersession,
  convergence, and cross-reference edges outbound, plus every ADR that cites it inbound.
- `npm run adr scopes [paths…]` — the diff-time arm: the ADRs whose declared `scopes:`
  prefixes govern the given paths (default: the paths changed on this branch).
- `npm run adr check` — validates every entry against the schema and the supersession
  contract; exits non-zero on a violation. Covered by `npm test`.

## Disclosure

The store reaches a build session through the session protocol in the repository's
inward `AGENTS.md`: a plan-time consult (`adr index`, read the matching ADRs in full)
and a close-out filing (a settled fork becomes an ADR draft). The protocol wiring is
inward; the store and its projector are outward — the same split the reference
implementation uses.
