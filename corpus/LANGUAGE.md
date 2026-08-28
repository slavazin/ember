# Corpus Authoring Language

The binding voice, vocabulary, and structure rules for every corpus artifact:
store READMEs, SCHEMAs, entries, skill packs, role templates, and generated
indexes. This file is a **register** — corrected in place; git history carries
its amendments. It lives in the corpus and ships with its scaffold; every
other file references it by path and never carries copies of it.

## Purpose

Two authoring failures this file exists to block:

1. **Declarative drift.** Different files naming one concept in different
   words until the concepts themselves fork. Countermeasure: the closed
   lexicon and the single-home rule.
2. **Session bias.** The authoring session writing what happened to it
   instead of what future sessions should do. Every corpus entry's reader is
   a future session that knows nothing of the session that wrote it.
   Countermeasure: the two invariance laws.

## The three laws

Every directive in this file — and in every SCHEMA derived from it — ships as
a pair: the "Do" plus the named overshoot the "Do" must not be taken to. A
directive without its counter-directive steers writers past one failure into
its opposite.

### L1 — Session-invariance

**Do:** write every sentence to be true and actionable in a future session
that knows nothing of the authoring session. State duties in the imperative,
premises in the present tense, evidence as dated facts. The corpus tells
future sessions what to do — never what was done to produce the telling.

**Don't (the overshoot):** don't strip provenance to achieve timelessness.
Anchors, dated measurements, and warrant citations are required content — L1
bans *narration of process*, not *evidence*. "Chosen after a long debugging
session" is narration; "false if: the storm reproduces below 50% pool
saturation (observed 2026-08-27, incident A)" is evidence.

| Banned tells | Legal replacement |
|---|---|
| this session, we, I, as discussed | (delete — address the reader) |
| now, currently, recently, at the moment | an as-of date, or nothing |
| new, latest, updated, improved, old | the referent's ID or name |
| was added, has been changed, we decided | present-tense statement of what stands |
| TODO, for now, temporarily | a revisit trigger `{when, then}`, or nothing |

### L2 — State-invariance (true-until-false)

**Do:** every sentence in a payload must be exactly one of three things:
(a) a **premise or trigger** that holds until a nameable event falsifies it;
(b) a **dated fact** — a measurement frozen with its as-of date;
(c) a **directive** to the reader.
Before committing a sentence, name the event that would make it false. If no
event is nameable and no date is attached, the sentence does not belong.

**Don't (the overshoot):** don't delete constraining context to pass the
test — relocate it. A decision stripped of its constraining facts is
unfalsifiable, which is worse than stale: the facts belong in the warrant's
falsification list, dated. L2's target is **tangential rot** — detail that
decays independently of the premise (tool versions, counts, org facts,
directory listings) riding inside a payload whose premise stays correct.
When the tangent rots, the entry reads false while being right, and readers
learn to distrust the store.

Decisions bear this law hardest, rules next: their payloads are pure
constraint-and-trigger, and everything else they want to say is either
warrant material (dated) or deleted.

### L3 — Bounded directives

**Do:** every directive ("Do X") ships with the counter-directive naming its
overshoot ("Don't X′") — the specific opposite error a writer lands in when
steering away from the original failure. In rules this is the `not-this`
clause; in SCHEMAs, skill packs, and role templates it is written as a
Do/Don't pair.

**Don't (the overshoot of this law itself):** don't manufacture vacuous
pairs. "Don't overdo it" bounds nothing — a counter-directive must name a
failure recognizable in a draft under review. And facts and premises need no
pair; L3 binds directives only.

## Voice by surface

| Surface | Voice | Never |
|---|---|---|
| Register (rules, latches, vocabulary, this file) | present tense, current state, corrected in place | history narration in the body — git carries history |
| Ledger (decisions, beliefs) | frozen verbatim; append or supersede, never edit | rewriting a committed entry, typos included — supersede it |
| README (store role) | present-tense description: what the store holds, who reads it, when, what retires entries | instructions to authors — those live in SCHEMA |
| SCHEMA (author contract) | imperative, addressed to the entry author | role description — that lives in README |
| Index / projection (generated) | activation and lifecycle fields only | any sentence a reader could comply with without opening the record |

## Reference discipline

**Do:** dates absolute (`YYYY-MM-DD`); references by stable ID (`D-0007`) or
path; things named by their referent, never by alias or position ("the
above", "the previous rule", "the new schema").

**Don't:** don't date decoration. A date marks a frozen measurement or an
adjudication event. An undated sentence *asserts an until-falsified truth* —
that is its meaning under L2, not an omission to fix.

## Lexicon

A closed vocabulary. Use these words for these concepts, no synonyms for
them, and none of them for anything else. A concept fitting no term enters
through the escape — proposed as `other(<what>)` with a definition — never
forced into a near-miss term and never given a private synonym.

| Term | Means | Not to be confused with / not to be called |
|---|---|---|
| store | one directory holding one kind of entry under one lifecycle | database, memory, pile, collection |
| entry | one record in a store, carrying the five-slot contract | doc, note, item; the *file* merely holds the entry |
| register | a current-state surface, corrected in place | log, history |
| ledger | an append-only history; entries frozen at admission | list, archive |
| admission | the merge that turns a draft into an entry and mints its ID | creation, saving |
| supersede | retire an entry by pointing to its successor | edit, update, fix |
| status flip | the only in-place change a ledger entry ever receives | amendment |
| payload | the cached judgment an entry exists to deliver | summary, description |
| warrant | what grounds a payload, causally independent of it | context, background, rationale prose |
| anchor | a git-reachable reference tying a claim to evidence | link, example |
| falsifier | the nameable event or predicate that would kill a claim | risk, caveat |
| latch | any condition an entry carries that routes attention to one of its five slots: hook, revisit trigger, wiring edge, floor gate, retirement condition | a synonym for trigger — the revisit trigger is one latch type of five |
| fires-when | a hook's work-shape condition: when a session should open or apply an entry | trigger |
| consult-when | a hook variant on world-claims: the work shape whose sessions depend on the claim | falsifier — consultation keys on work-shape, falsification on world-state |
| moot-when | a retirement condition: the event under which an entry's domain stops existing | falsifier — mootness retires without contradicting |
| not-this | a hook's declared exclusions — shapes it matches but must not bind | exception, edge case |
| trigger (revisit) | a world-state condition `{when, then, settled}` that re-opens a warrant | fires-when; reminder |
| residue | what an entry's enforcement does not check, stated on the entry | limitation, disclaimer |
| duty | the obligation a rule's payload carries, as narrow as is true | guideline, suggestion |
| surface | a distinct area of the estate a duty can bind at (a service, a store, a workflow) | site is acceptable in prose; never "place", "area" |
| promotion / demotion | tier movement of knowledge, always human-performed | upgrade / cleanup |
| mootness | the retirement condition "the domain no longer exists" | irrelevance, low use |

## Latch language

Governs every latch in an entry's fan that is written as words: hooks
(`fires-when`, `consult-when`, a routing summary line), revisit triggers
and falsifiers (`when`, `falsifier:`), and retirement conditions
(`moot-when`). Wiring edges and floor gates are IDs and mechanisms, not
prose, and are exempt. A condition is written by a
producer for a consumer who is a future session holding only the work in
front of it. The two never meet, and no mechanism repairs a key that fails
to fire — a missed condition is silent forever, so the condition's words are
the entire channel.

**Do: key on the presentation, not the conclusion.** Phrase the condition in
what the consumer already holds *before* the payload has helped — the
symptoms, the shape of the task as it arrives. A condition keyed on the
payload's own conclusion ("when the connection pool is exhausted…") can fire
only after the entry is no longer needed; the latchable form is how the
situation presents ("diagnosing latency or timeouts in a service with a
datastore client").
**Don't:** don't reduce the condition to surface features with no relation
to the payload — presentation words must still track the payload's domain,
or the fire teaches the consumer nothing.

**Do: bias broad — the costs are asymmetric.** A false fire costs one
considered-not-applicable disposition, seconds of attention, and doubles as
the telemetry that later narrows the hook. A miss is a structural zero:
unreachable knowledge, invisible until a defect or a human correction pays
for it. When unsure whether a shape belongs in the condition, include it.
**Don't:** don't broaden past prediction. Breadth is bounded by relation to
the payload, not by ambition: a condition matching shapes with no plausible
route to applying the payload erodes the walk itself — a table that mostly
cries wolf gets skimmed, and skimming is a miss factory. Recover precision
through `not-this`, never by shaving the base condition on speculation.

**Do: build conditions from the shared vocabulary.** The lexicon, plus the
work-shape terms a tenant grows, is the asynchronous bridge between producer
and consumer: the only assumptions that survive the gap between the
authoring session and the reading session are the ones carried by words both
provably hold. When a recurring work shape has no name, name it into the
vocabulary first, then latch on the name.
**Don't:** don't coin the name inside the condition. A term minted ad hoc in
one latch is an assumption smuggled across the bridge — the consumer parses
it differently or not at all, and the divergence is undetectable. New terms
enter through the lexicon's escape, then become latchable.

## Mechanical checks

Lint hooks derivable from this file. Each checks presence or shape, never
judgment — the floor, honestly disclosed:

- banned-tell grep (the L1 table) over corpus files, excluding this file's
  own tables and quoted examples — they mention the tells, never use them
- date format `YYYY-MM-DD` wherever a date appears
- Do/Don't pairing: every `**Do:**` in a SCHEMA has a sibling `**Don't:**`
- every store README declares register or ledger
- no `fires-when` inside a decision body (duty language belongs to rules)

Residue: none of these checks that a sentence is true, that a Do/Don't pair
is non-vacuous, or that a declared falsifier is the right one. Those remain
review judgments.
