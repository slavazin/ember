---
name: session
description: The fast-loop protocol — boot and close. Load at session start (boot obligation) and again before ending, to orient, walk the latch tables, and file dispositions and drafts.
---

# session — the fast loop

The per-session protocol: how a session boots from the corpus and closes back
into it. Loaded by boot obligation at start, and again before close. Learning is
corpus-carried, not thread-carried — a session that starts from an empty context
recovers everything from the stores, so the boot and the close are the whole
memory.

## Boot

1. **Load the law.** Open the `constitution` skill before any planning.
2. **Recover open work.** Read the close-out carried by the last merged pull
   request, and the open branches and pull requests that carry unfinished work.
   There is no session log and no carry-forward file — the pull request is the
   record, and git history is the trace.
3. **Orient.** Declare the shape of the work in hand — the terms a store index or
   a latch row can match against.
4. **Walk the planning latches.** Poll each row of `corpus/latches/planning.md`
   against the work in hand and discharge the owed act of every row that fires;
   leave the walk's `latch-walk:` attestation line in the work product (format
   below).

**Do:** declare the work-shape before opening any store — the shape is what the
indexes and latch rows route on.
**Don't:** don't open stores at random ahead of a declared shape; an unrouted
read is the scan the indexes exist to replace.

**Do:** emit the planning walk's `latch-walk:` line in the work product.
**Don't:** don't treat the attestation as proof the consultation was honest — it
proves only that the walk ran; the honesty of the consultation is permanent
residue.

## Close

A session does not end without the close-out, and the close-out is the session's
pull request — the record the next boot reads. The session files this pull request
whether or not it drafts a candidate entry; the dispositions and the closing
attestation are content enough, and the push is approval-gated.

1. **Record dispositions.** Into the pull request, record one disposition for
   every entry the session consulted:
   - **applied** — the entry bound the work and its payload was used.
   - **considered-not-applicable** — the entry was consulted and set aside: its
     `not-this` matched, or its payload did not bind the work in hand.
   - **fired-off-map** — the entry's hook matched a work shape the corpus does
     not cover; the fire surfaced a gap, and the observation is a promotion
     candidate.
2. **File candidates.** A candidate entry, when the session has one, is drafted
   through the `corpus-write` skill and rides the same pull request. A draft
   carries no id — admission mints it.
3. **Walk the closing latches.** Poll each row of `corpus/latches/closing.md`
   against the work in hand, discharge the owed act of every row that fires, and
   leave the walk's `latch-walk:` line in the pull request.

**Do:** file the session's pull request even when no candidate is drafted — the
dispositions and closing attestation are a durable record on their own.
**Don't:** don't skip the pull request on a quiet session; an unfiled close-out
is state the next boot cannot recover.

**Do:** record a disposition for every consulted entry — the dispositions are the
telemetry the slow loop promotes from.
**Don't:** don't leave a consulted entry undisposed; an unrecorded consultation
is a signal lost forever.

**Do:** file every candidate as a draft on the branch and let the human merge
admit it.
**Don't:** don't write to a permanent store directly — the merge is the only
admitting write.

## The latch walk

A latch table is a register of rows ⟨fires-when → consult → owed act⟩ read whole
at its walk point (see [/corpus/latches/README.md](/corpus/latches/README.md)).
Walking polls each row against the work in hand; a row that fires owes its one
act. A table holding only its header row owes an empty walk.

The walk leaves one attestation line in the work product it governs — the
diagnosis report for the planning walk, the pull request for the closing walk:
`latch-walk: <table> @ <ref>`. `<table>` is the walked table (`planning.md` or
`closing.md`); `<ref>` is a git-reachable reference to the session — its branch,
commit, or pull request. The line is the floor gate's presence anchor, matched at
line start: a walk that fires no row still emits it, and the rows that fired with
the acts discharged are recorded after the line.

**Do:** emit the `latch-walk:` line at each walk point, even when no row fired.
**Don't:** don't reword the line's prefix or shape — the gate greps it at line
start, and a reworded attestation is a walk the gate cannot see, a silent miss.

**Do:** poll every row against the work in hand.
**Don't:** don't skim a table because it rarely fires — a rarely-firing row can
be the one that matters, and skimming is a silent miss.
