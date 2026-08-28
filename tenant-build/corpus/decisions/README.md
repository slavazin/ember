# decisions/ — the build's architecture-decision record

**Kind:** ledger. Entries are frozen at admission: superseded or status-flipped,
never edited — typos included.

**Holds:** settled architecture and process decisions of this repository's own
build: one entry per adjudicated fork, stating the constraint it puts on future
build work and the facts that would reopen it.

**Live question:** is this still the right design? An entry is contradicted by a
premise on its warrant reversing, or by the fork it decided ceasing to exist —
never by disuse.

**Admission bar:** one adjudicated fork plus a human merge. Unlike the incident
tenant's case store, recurrence is not the bar — an architecture decision is
settled by adjudication, not by being observed twice. Applying the case store's
two-recurrence bar here would bind a lifecycle that does not share its trait.

**Reader and moment:** a build session at plan time, scanning the one-line
summaries (`adr index`); the full entry is opened when a summary matches the work
in hand, or when the session touches a path the entry's `scopes:` declares. A
summary invites the read — it never substitutes for it, and complying with a
summary alone is a defect on the reader's side.

**Retirement:** a status flip — `superseded` (with a successor pointer), `moot`
(the decided fork no longer exists, no successor), or `converged` (the decision is
absorbed into a constitution article or a later ADR, named in `converged-into`).
Entries are never deleted; the history of a reversed design is retained on purpose.

**Promotes to:** a load-bearing ADR is lifted into the build's constitution
(`planning/CONSTITUTION.md`, the twelve-article inward register), recorded on the
ADR by `promoted-to:`. The ladder is session observation → ADR → constitution
article, mirroring the layer corpus's decisions → rules → constitution ladder.

**Language:** every entry is authored under [/corpus/LANGUAGE.md](/corpus/LANGUAGE.md) —
the three laws, the reference discipline, the lexicon, and the latch language. Read
it before authoring; never copy from it.
