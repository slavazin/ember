---
name: session
description: The fast-loop working-session protocol — orient from the corpus at start, resume any unfinished work, walk the planning latches, and keep the consultation record the close reads. The close-out is its own skill, `close`.
---

# session — the fast loop, working-session half

The working session's protocol: how a session orients from the corpus at start,
and the consultation record it keeps as it works. Loaded by boot obligation, after
the constitution. Learning is corpus-carried, not thread-carried — a session that
starts from an empty context recovers everything from the stores, so the boot and
the close are the whole memory. The close-out half — dispositions, retro lenses,
candidates — is the `close` skill, run from fresh context after implementation; it
reads the consultation record the working session keeps.

## Boot

1. **Load the law.** Open the `constitution` skill before any planning.
2. **Resume unfinished work.** Read the open branches and pull requests that
   carry work left un-merged, and resume it. Cross-session learning is not
   recovered here — it is corpus-carried, loaded from the shape-matched stores
   below; a session that finds nothing open still boots whole from the corpus.
   There is no session log and no carry-forward file — the pull request is the
   record, and git history is the trace.
3. **Orient.** Declare the shape of the work in hand — the terms a store index or
   a latch row can match against.
4. **Walk the planning latches.** Poll each row of `corpus/latches/planning.md`
   against the work in hand and discharge the owed act of every row that fires;
   leave the walk's `latch-walk:` line in the work product (format and cautions:
   [/corpus/latches/README.md](/corpus/latches/README.md)).

**Do:** declare the work-shape before opening any store — the shape is what the
indexes and latch rows route on.
**Don't:** don't open stores at random ahead of a declared shape; an unrouted read
is the scan the indexes exist to replace.

**Do:** emit the planning walk's `latch-walk:` line in the work product.
**Don't:** don't treat the attestation as proof the consultation was honest — it
proves only that the walk ran; the honesty of the consultation is permanent
residue.

**Do:** boot the whole picture from the corpus — a merged candidate is already an
admitted entry in the shape-matched stores.
**Don't:** don't reach back into a prior session's pull request to recover
learning; learning is corpus-carried, and a merged request's payload is read from
the stores, not from the request.

## Keep the consultation record

As the session works, record each entry it consults into the work product on the
branch — the entry's id and whether it was applied or considered — as the
consultation happens. The planning latch walk starts this record; the work appends
to it. This record is what the fresh-context close reads to disposition every
consultation, including the considered-and-set-aside ones that leave no other
trace on the branch. The close assigns the final disposition; the working session
supplies the set.

**Do:** append each consulted entry to the work product as it is consulted — while
the context that holds it is still live.
**Don't:** don't defer the record to the close; the close runs from fresh context
and cannot recover a consultation the working session did not write down.

## Diagnose, then remediate

Between boot and close the session resolves the incident in front of it: it
diagnoses the surface through the `investigate` skill, then — by default —
remediates the diagnosed cause through the `implement` skill. The diagnosis is the
input the remediation is filed against, so the fix follows the diagnosis and never
precedes it. Remediation is the standing next step, not an optional one: an
incident a session can diagnose is an incident it resolves, unless the diagnosed
cause lies outside the estate's reach — an upstream fault — where the resolution is
the escalation and bounded mitigation the diagnosis warrants (the `implement` skill
carries that exception).

**Do:** remediate a diagnosed incident by default through the `implement` skill,
once `investigate` has frozen the diagnosis.
**Don't:** don't stop at a diagnosis when the cause has an in-estate lever — a
diagnosis filed without the fix it warrants leaves the incident open behind a
closed session.

## Close

The close half is its own protocol, run from fresh context after implementation:
the `close` skill. A session does not end without the close-out it carries.

**Do:** run the `close` skill from fresh context once implementation is done — the
close judges the work best without the implementer's context.
**Don't:** don't fold the close back into the implementing turn; the fresh read is
the point of the split.
