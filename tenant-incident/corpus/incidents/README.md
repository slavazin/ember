# incidents/ — the incident case ledger

**Kind:** ledger. A closed incident is frozen at admission; a case that needs
re-adjudication is superseded, never edited, because the record is the evidence
a later case of the same class reasons from.

**Holds:** closed incident cases. Each entry is one occurrence — its symptom
and impact, the probe made before the fix committed, the root cause found, and
the learning the class carries forward — frozen together in the admitting
commit. This is tenant knowledge: it belongs under the incident tenant, never
in the reusable layer (Constitution Art. 7). The rule, belief, or decision a
case nominates lives in that case's target store and cites the case as its
anchor; the case itself is the evidence, not the constraint.

**Live question:** what happened, and what should the next incident of this
class reach for sooner? An entry is never re-opened to ask whether it is still
correct — a case is a dated fact, not a standing premise. It is contradicted
only by a re-adjudication that finds the recorded mechanism wrong.

**Reader and moment:** a session diagnosing an incident whose shape matches a
prior case's `class`, while that diagnosis is open; and the slow loop reading a
class's cases in order to measure the learning delta — incident N against
incident N+k of the same class. The `class` and `surface` coordinates are the
hook that routes both readers to the right cases.

**Retirement:** supersession or mootness. A re-adjudication that overturns the
recorded root cause supersedes the case, pointing to its successor; a case
whose class stops existing goes moot. Retired cases remain as the record of
what was diagnosed, when, and at what forecast.

**Relationship to the layer:** the layer defines the decision, rule, and
belief stores co-referenced under [/corpus](/corpus/README.md); this store is
a self-describing tenant store — it ships its own contract in
[SCHEMA.md](SCHEMA.md) because no layer store carries incident-case semantics,
so its entries are governed by that contract, not by the layer entry checks.
Its shape is gated by the store's own validator and its immutability by
corpus-lint's frozen-path check — the split the SCHEMA's floor-gate note
records; the distinction from a decision record is argued in the SCHEMA header.
