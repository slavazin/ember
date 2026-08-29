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

Spawn an **examiner** subagent to attack the draft. Paste the template below
verbatim, then append the draft entry's text frozen and unaltered
(freeze-the-target). The examiner earns its dispatch by holding a perspective the
drafting root cannot — it did not write the entry, so it reads the claims cold,
and an unprimed reader catches an assumption the author no longer sees. The
template sharpens that attack and travels with the dispatch, so the examiner
never depends on a file resolving outside this skill; a subagent that receives a
thinner brief still does useful work, and a missing template degrades the review
rather than ending it.

> You are an examiner. A draft entry follows this template, frozen and unaltered.
> Your task is to attack it — never to author, edit, or rewrite it.
>
> **What to attack.** Attack every slot of the draft and report where it fails:
> - **True?** Is the payload true against the corpus and the codebase, or does an
>   existing entry, a recorded fact, or observable state contradict it?
> - **Fires when intended?** Does the hook (`fires-when`, `consult-when`, or the
>   summary) match the shapes it claims, and exclude the shapes it must not? Name
>   a misfire a router would wrongly match.
> - **Duplicate?** Does an admitted entry already carry this judgment? Name it.
> - **Bounded?** Is the exclusion (`not-this`) present and real, or is the duty
>   wider than its warrant supports?
> - **Warranted?** Do the anchors carry the claim, or is an assertion unanchored?
>
> **What to return.** Return a verdict-pending record: your findings, each phrased
> as an attack with its evidence, and the verdict field left empty. You never fill
> the verdict — the adjudicating human fills it at merge. You hand the record back
> to the dispatching root; you never write to a store.
>
> **Do:** attempt to refute every slot, and report a doubt rather than withhold it.
> **Don't:** don't author or edit the draft — you hold no stake in its admission,
> and a suggested rewrite is outside your role.
>
> **Do:** leave the verdict empty and hand the record back.
> **Don't:** don't declare a verdict or a pass — the record stays pending until a
> human merges it.

**Do:** freeze the target — append the draft's exact text to the examiner
dispatch.
**Don't:** don't summarize or edit the draft before handing it over; the examiner
must attack the entry as it would be admitted, not a cleaned copy.

**Do:** file the examiner's record into the same pull request as the draft, its
verdict field empty.
**Don't:** don't fill the verdict — the verdict is the human's, written at merge.

## Filing

File the draft and the examiner record on the session's branch; the push is
approval-gated. The pull request carries the draft, the examiner record, and the
evidence; its merge is the durable human gate that admits the entry and mints its
id.

Build the candidate commit in the sandbox under the deposit identity, so the
signature rides the patch the host pulls back and survives into the merged
history. The author is the agent, the committer the host that applies the patch,
the merge the human that admits it — git's three parties carry the propose,
apply, and adjudicate roles, so an agent-authored commit leaves the human the
sole committing and admitting party. Commit under `incident-responder
<incident-responder@ember.invalid>`, and carry a trailer block that places the
deposit in the learning arc:

    git -c user.name='incident-responder' \
        -c user.email='incident-responder@ember.invalid' \
        commit -m 'Corpus deposit — <class>: <one-line>' -m '' \
        --trailer 'Incident-Id: <incident-id>' \
        --trailer 'Incident-Class: <class>' \
        --trailer 'Corpus-Store: <target store path>' \
        --trailer 'Deposited-By: incident-responder'

`Incident-Class` groups a class across incidents and the commit's author-date
orders it, so one incident and a later incident of the same class read out of git
history directly. The iteration ordinal is that ordering; a deposit carries the
class and leaves the count to be derived, never freezing a hand-set number.

**Do:** commit the deposit under the `incident-responder` author and the
`Incident-*` trailer block, so the signature separates it from build work
wherever the merged history is read.
**Don't:** don't commit under the ambient sandbox identity or a build co-author
trailer — an unsigned deposit is indistinguishable from build work in the shared
pull-request stream, and the learning delta cannot be read from a history that
cannot separate them.

**Do:** file candidates on a branch and open a pull request.
**Don't:** don't push to the main line — a direct write bypasses the gate the
whole procedure exists to serve.
