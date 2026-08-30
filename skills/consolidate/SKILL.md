---
name: consolidate
description: The slow-loop consolidation pass — read the accumulated fast-loop pull requests, walk the consolidation lenses over their signal, propose each ratified recurrence's cheapest existing home, and draft promotions through corpus-write for the human to route and adjudicate.
---

# consolidate — the slow loop, agent-drafting half

The slow loop's agent-drafting pass: it reads across the accumulated fast-loop
pull requests, walks a fixed set of consolidation lenses over the signal they
carry, proposes for each ratified recurrence the cheapest authority that already
covers it, and drafts the residue as promotion candidates through the
`corpus-write` skill. It **proposes**; the human routes, adjudicates, and merges.
The graded bars and the route-before-mint ladder the human runs are the
`promotion-review` skill, cited here and never restated.

The slow loop is where knowledge moves between tiers, and it runs where the human
is present. This pass is the agent half of that work — the drafting a fresh
reader does across sessions — split from the human's adjudication half exactly as
the fast loop's `close` is split from its `session` boot. This pass feeds the
corpus stores the fast loop deposits into — the case store `corpus/decisions/`, the
rule store, the belief store — and each store's own admission bar governs, not a
bar carried across stores. A single record never drives a case-store decision or a
rule: recurrence is their bar, read across pull requests. A belief is the exception
— recurrence is not its bar; a single novel world-facing claim is admissible on its
falsifier, deadline, and reference price (the `promotion-review` skill). A decision
store on a different lifecycle — the build ADR store, admitting one adjudicated fork
— is not this pass's subject and does not borrow the case store's recurrence bar.

Load this at a consolidation pass, from fresh context. It re-derives its inputs
from git history and the pull requests, so an agent holding none of the fast
loop's context runs it in full.

## Corpus reachability (invariant)

**The corpus is ensured reachable before any corpus read.** Every `/corpus/…`
path this pass reads — the lens language, the latch tables, and the target
stores it searches for a candidate's cheapest existing home — resolves through a
repo-root symlink the sandbox does not carry by default, and the sandbox is
recycled after an idle interval, dropping a corpus provisioned once at boot while
the harness re-clones only the skills. So reachability is an **invariant
re-ensured before each corpus-touching read**, never a boot-once step: discharge
it with an idempotent guard that no-ops when the corpus already resolves and
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
`tenant-incident/scenarios/`: the scenario is the environment, not this pass's
subject, and the sparse set materializes only those two subtrees. The filing this
pass hands to `corpus-write` re-ensures the same invariant before it writes.

**Do:** re-ensure reachability with the idempotent guard before each corpus read —
a no-op when `/corpus` resolves, a self-heal when a recycle has dropped it.
**Don't:** don't provision the corpus once at boot and treat it as durable — the
idle recycle drops the provisioned corpus while re-cloning the skills, so a
boot-once step reads an empty `/corpus` on a later turn.

## What this pass reads

The input is the signal the fast loop deposited: the per-entry dispositions
(applied / considered-not-applicable / fired-off-map), the lens answers that
survived their counterfactuals, and the candidate drafts. Every close-out is a
fast-loop pull request — filed even by a quiet session that drafts no candidate,
its dispositions and lens answers content enough (see the `close` skill) — so the
disposition telemetry, the bulk of it from quiet sessions, is read across all of
them and never gated on a deposit. The `Incident-Class` commit trailer groups the
deposits by class where a candidate was filed and its author-date orders them (see
`corpus-write`); a close-out that deposits nothing carries no trailer and is keyed
instead by the work-shape it declares at boot (see the `session` skill), so no
close-out's telemetry is dropped for lacking a deposit. A merged pull request's
candidate is already an admitted entry in the shape-matched stores; its
dispositions and un-promoted lens answers live only in the pull request, and that
residue is this pass's raw material.

Reading a pull request for its signal is not applying its knowledge. A candidate
on an un-merged pull request is knowledge the human has not admitted; this pass
consumes it as evidence toward a promotion draft, and never binds it into work or
carries it into a store (Article 2). The fast-loop boot may not learn from a prior
pull request — learning is corpus-carried — but the slow loop's whole office is to
consume the fast loop's deposited signal; the two are different acts on the same
record.

**Do:** gather the dispositions and surviving lens answers across the pull
requests of a class before opening any lens — recurrence is read across records,
not within one.
**Don't:** don't promote a case-store decision or a rule from a single pull
request; one occurrence is at most a candidate draft, and a case or rule minted
from it is a guess wearing the store's authority — a belief, whose bar is a
falsifier and price rather than recurrence, is the standing exception.

**Do:** treat an un-merged candidate as evidence only, cited in a draft's warrant.
**Don't:** don't bind or apply an un-admitted candidate as though it were a store
entry — its merge has not happened, and reading it as knowledge pre-empts the
human gate.

## 1. Filter noise before updating

Classify each recurring failure the signal shows: **reducible** — a duty was
missed, and it routes to an authoring change — or **irreducible-at-the-time** — no
entry that could exist would have caught it, so it is aleatoric. An irreducible
recurrence tunes the detection side (a hook's recall, a probe's coverage) and
never the authoring side; minting a rule from an unforeseeable miss overfits the
corpus to a one-off.

**Do:** split reducible from irreducible before any lens indicts a slot — the
filter is what keeps the corpus from hardening around noise.
**Don't:** don't route an irreducible recurrence to an authoring change; tune
detection instead, or record it as considered and file it no further.

## 2. Walk the consolidation lenses

A **lens** is a guiding question paired with its counterfactual — an angle on the
accumulated signal, and the challenge that keeps the angle's answer honest (see
the lens language in [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md)). Walk each lens
against the signal of a class. An answer that survives its counterfactual is a
consolidation candidate, carried to step 3; an answer the counterfactual dissolves
is filed no further.

Each lens indicts a **slot** — the contract pentad is the coordinate system in
which a text-space correction becomes local: the pass asks which slot the evidence
indicts and which way, never "is this entry good?".

| Lens | Angle | Counterfactual |
|---|---|---|
| recurrence | Which observation or fired-off-map signal recurs across independent pull requests on distinct surfaces, enough to clear a tier's bar? | Are the recurrences independent and one shape — or is one context's signal counted twice, or near-misses forced under one label? |
| activation | Does the applied-versus-considered split, or an off-map fire, indict a hook — a routed-but-not-applicable stream to narrow, or a boundary the declaration drew wrong to widen? | Is the distribution signature-relative — a hook firing hard in a period whose work is its shape is the system working, not a hook to prune? |
| payload | Where a recalled, applied entry still let the outcome go wrong, is the fault altitude — abstract it — or content — re-derive it? | Was the entry's steer actually reached and used, or is this an activation miss wearing a payload fault's clothes? |
| warrant | Which admitted entry has a falsification-list fact reversed, a revisit trigger fired, or an anchor rotted, nominating re-adjudication? | Is the premise genuinely reversed against observed facts — the entry thereby false — or is the work wrong while the entry holds? |
| fold-split | Do two entries' answers converge on an entailment edge (fold), or does one apply cleanly on one sub-shape and never another (split)? | Is the convergence a true entailment licensing the fold — default fold-before-split — or coincidental co-firing a merge would wrongly fuse? |
| lifecycle | Which standing entry never fired across the periods, or has its shape stop occurring, or its duty absorbed by a floor gate — nominating demotion? | Is low firing a mootness signal, or a rarely-firing entry that is the one that matters — retirement keys on mootness and coverage migration, never on low salience? |

**Do:** answer a lens only with its counterfactual answered too — the pair is the
lens, and the counterfactual is what filters slop before it reaches the human.
**Don't:** don't file a lens answer whose counterfactual dissolves it; a candidate
that cannot survive its own challenge is noise the adjudicator must clear.

**Do:** let the evidence type name the slot and the direction, and let the
recurrence count nominate — the magnitude and the verdict are the human's.
**Don't:** don't rewrite an entry holistically because it "seems wrong"; an
un-slotted correction inherits the attribution weakness the pentad exists to cure.

## 3. Propose the route before minting

Before drafting an entry, propose for each surviving candidate the cheapest
authority that already covers it, walked in order. The route is a **proposal**,
not the authoritative placement: this pass researches and names the cheapest home
and drafts to it; the human performs or redirects the route at adjudication (the
`promotion-review` skill holds the ladder the human runs). Minting is the last
resort, because every standing mechanism taxes every future session it routes to,
and the ladder prices that at admission. Refusal is a first-class outcome: a
recurrence that no tier's blast radius justifies is recorded as considered and
minted nowhere.

| The candidate is… | Its cheapest home is… |
|---|---|
| a correction to an existing entry's hook, payload, or exclusion | an edit to that register entry, or a superseding successor to that ledger entry |
| a duty already carried, missed on a further surface | a second decision cited into an existing rule's warrant, or a `not-this` line on it |
| a recurrence an admitted rule operationalizes | a citation from that rule — never a parallel entry restating it |
| a checkpoint an existing latch row already owns | a hook edit on that row (see [/corpus/latches/README.md](/corpus/latches/README.md)) |
| a duty no checkpoint carries, on an authority not yet in the walk | a minted latch row — only as an authority joins the walk |
| a judgment no existing entry carries | a minted entry in the store its slot signature names (step 4) |

**Do:** search the target store and the latch tables for an entry the candidate
extends before drafting one, and propose routing to it when one exists.
**Don't:** don't draft a duplicate — two entries for one judgment fork the moment
one is corrected, and the router never learns which to fire; and don't perform the
authoritative route yourself — the placement is the human's at merge.

**Do:** record refusal as an outcome when no tier earns the recurrence.
**Don't:** don't promote to clear a backlog; a mechanism minted to look thorough
taxes every future session and earns back nothing.

## 4. Draft, examine, and file for adjudication

A candidate that routes to a minted entry takes the store its **slot signature**
names — a settled constraint on a fork is a **decision**; a duty owed whenever a
work shape recurs is a **rule**; a dependence on a world-facing claim that a
nameable event could falsify is a **belief** (the slot-signature table is the
`promotion-review` skill). Draft it through the `corpus-write` skill: fill the
five-slot contract against the target store's SCHEMA, anchor its warrant to the
pull requests and admitted entries it aggregates, spawn an examiner to attack the
draft, and file both on a branch through the approval gate. The pull request's
merge is the admitting write; this pass never mints an id.

Hold each promotion to the bar its tier declares in the `promotion-review` skill —
a rule to two case-store decisions on distinct surfaces, a case to two anchored
recurrences, a belief to a declared falsifier, a deadline, and a reference price.
The bars are that skill's, cited here, not copied.

**Do:** file one candidate per surviving lens answer, each anchored to the records
it consolidates, and let the human's merge admit it.
**Don't:** don't bundle several judgments into one entry to save a pull request; a
fused entry latches on the wrong hook and cannot be adjudicated slot by slot.

**Do:** raise the abstraction to the constraint the aggregated anchors support —
decoupled from the surfaces it was observed on, no further than those anchors can
still falsify.
**Don't:** don't abstract past the evidence; a claim the anchors cannot bite is a
slogan, and the warrant that would retire it is missing.

**Do:** hand each draft to an examiner that did not write it, and file the
verdict-pending record beside the draft (the examiner template travels with
`corpus-write`).
**Don't:** don't let this pass adjudicate its own drafts; review is external to the
party reviewed, and the verdict is the human's, written at merge (Article 3).
