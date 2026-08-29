---
name: constitution
description: The always-on operating law, loaded by boot obligation before any planning — a capped register of the layer's binding constraints.
---

# The constitution

The layer's binding operating law: the constraints a session holds before any
planning. The saved agent's instructions load this skill before planning begins;
that boot obligation is what carries an always-on tier without an always-loaded
mechanism.

This is a **register** — corrected in place, never narrated; git history carries
its amendments. It is capped at **ten articles**. The cap is a hard limit, not a
target: an addition that would exceed ten requires evicting an article in the
same change, and the count is enforced by `corpus-lint` on this file. Each article states a bare constraint;
the procedure that discharges it lives in the named skill, in one home, never
restated here.

## Article 1 — The substrate is git, read through skills.
Every store is git-backed markdown read through the skills mechanism, this
constitution included; no database, no bespoke memory service.

## Article 2 — No agent writes to a permanent store.
An agent files candidates on a branch; a human's merge is the only write that
admits an entry. Procedure: the `corpus-write` skill.

## Article 3 — Role separation is subagent separation.
Roles that must be independent are distinct subagents; no subagent reviews its
own output, so review is external to the party reviewed; the human is the only
committing party.

## Article 4 — A session boots from the corpus and closes into it.
A session boots from this constitution and the shape-matched stores — its
cross-session memory is the admitted corpus, not a prior pull request — and
resumes any work left un-merged on a branch; it does not end without the
close-out. Procedure: the `session` skill (boot) and the `close` skill (close-out).

## Article 5 — Probes run in the sandbox only.
Every hypothesis test runs in a sandbox; nothing speculative touches a live
surface.

## Article 6 — Layer and tenant are strictly separated.
The reusable layer carries zero tenant knowledge; a tenant's entries live in its
own tree, and a second tenant installs without touching a layer file.

## Article 7 — Derive what you can; hand-author only judgments.
Indexes and views are generated, never hand-maintained; a lint enforces the entry
contract and the caps, and states plainly what it does not check.

## Article 8 — Frozen means frozen.
A ledger entry is superseded, never edited; a belief freezes with its falsifier
and deadline at admission; every store declares itself register or ledger.

## Article 9 — Seed minimal; mint from your own misses.
The corpus starts at the smallest set that runs one loop; permanent knowledge is
minted from observed recurrence, never imported wholesale; a marked import never
skips the promotion ladder. Procedure: the `promotion-review` skill.
