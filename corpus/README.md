# Corpus

The knowledge corpus. Every store starts empty and grows only through
governed admission. The standing files — this README, the store READMEs and
SCHEMAs, and [LANGUAGE.md](LANGUAGE.md) — are the reusable scaffold: they
carry no tenant knowledge, and a standing file that names a tenant concept
is a defect. Entries carry the tenant's knowledge; installing the scaffold
into another tenant means copying the standing files, never the entries.

The corpus has no constitutional store: always-on duties ride the skill
tier — the first stage of the three-stage attention — never a directory of
entries.

## Stores

| Store | Live question | Kind | Admission bar |
|---|---|---|---|
| [decisions/](decisions/README.md) | is this still correct? | ledger | two anchored recurrences + human merge |
| [beliefs/](beliefs/README.md) | is this still true of the world? | ledger | declared falsifier and deadline + human merge |
| [rules/](rules/README.md) | is this duty discharged wherever it binds? | register | **the most gated store:** at least two decisions from distinct surfaces + human merge |
| [latches/](latches/README.md) | should a session still check this here? | register | an admitted rule, or an externally warranted duty, enrolling |
| [vocabulary/](vocabulary/README.md) | do producers and consumers still parse this term the same way? | register | two independently anchored uses + human merge |

## Store shape

Every store directory ships exactly two standing files beside its entries:

- **README.md** — the store's role: its live question (what falsifies its
  entries), its register-or-ledger declaration, its reader and moment (who
  opens it, when), and its retirement path.
- **SCHEMA.md** — the author contract: required fields and sections, closed
  vocabularies with escapes, the store's voice rules as Do/Don't pairs, and
  one worked skeleton. An author must be able to write a valid entry from
  SCHEMA.md alone.

**Do:** keep each statement in exactly one home — role facts in README,
authoring instructions in SCHEMA — and cross-reference by filename.

**Don't:** don't make either file self-contained by duplication; two copies
of one statement fork the moment one is corrected.

## The latch fan

Activation is not one latch. Every entry carries five — one per contract
slot — and an entry missing one has a slot nothing will ever service:

| Latch | Attached to | Answers |
|---|---|---|
| hook (`fires-when`, `consult-when`, a routing summary line) | payload | when does a working session apply this? |
| revisit trigger (`{when, then, settled}`, `falsifier:`, `deadline:`) | warrant | what world event forces re-adjudication? |
| wiring edge (`warrant:`, `superseded-by:`, a latch row's `consult`) | the warrant's dependencies | which neighbor's change requires a re-check here? |
| floor gate (`floor:`, lint rules) | enforcement | what mechanically checks this, at which seam? |
| retirement condition (`moot-when:`, `deadline:`) | lifecycle | what nominates this entry's retirement? |

A latch uniform across a store is declared once, in that store's SCHEMA
under "Inherited latches", and every entry inherits it; a latch that varies
per entry is a required field.

**Do:** when authoring an entry, walk all five latches and fill or inherit
each.

**Don't:** don't manufacture per-entry variation where the store-uniform
latch is honest — restating an inherited latch in every entry is
duplication, and it drifts.

## Admission and identity

Proposals live on branches. An un-merged draft has no eternal ID and may be
discarded without trace; the merge is the admission — it mints the ID
(`D-`/`R-`/`B-nnnn`: reserve-once, immutable, gap-tolerant) and stamps the
adjudication. IDs never encode tier or status. Retirement is a status flip
plus a successor pointer — never deletion, never an in-place edit of a frozen
entry.

The event record is git history itself: proposals, adjudications, and
supersessions are read from commits and merged pull requests, not from a
parallel hand-written log. A hand-maintained copy of anything derivable from
history is a defect.

## Authoring language

Every standing file here, and every entry authored from the SCHEMAs, is
written under [LANGUAGE.md](LANGUAGE.md): the three laws, the
reference discipline, the lexicon, and the latch language governing every
condition field. Read it before authoring; never copy from it — copies
drift, and the pointer is the contract.
