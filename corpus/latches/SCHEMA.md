# SCHEMA — latch row

Rows live in `planning.md` and `closing.md`, one markdown table each:

```markdown
| fires-when | consult | owed act |
|---|---|---|
| diagnosing latency or timeouts in a service with a datastore client | rules/ | apply matching rules before free-form investigation |
```

## Fields

- **fires-when** — the recognition condition, at most fifteen words,
  self-contained: a reader holding only the current work's shape can answer
  fires-or-not without opening anything.
- **consult** — exactly one authority: a store, an entry ID, or a tool.
- **owed act** — one bounded, observable act the firing row obligates.

The `fires-when` field is a condition field: write it under the latch
language in [../LANGUAGE.md](../LANGUAGE.md) — key on presentation,
bias broad, build from the shared vocabulary.

## Inherited latches

Per row: `fires-when` (hook). Store-uniform, inherited by every row:

- **Revisit trigger and wiring edge:** the `consult` authority, one edge
  serving both — the authority superseded means the row follows the
  successor pointer; the authority dissolved means the row retires with it.
- **Floor gate:** a presence check that the governed work product carries
  the walk's attestation. Residue: presence proves the walk happened, never
  that the consultation was honest.
- **Retirement condition:** mootness of the `fires-when` shape, or a merge
  when another row owns the same owed act.

## Do / Don't

**Do:** name one authority per row.
**Don't:** don't chain ("check X, then Y, then Z") — a chain is several rows,
or a procedure that belongs behind a single named authority.

**Do:** keep `fires-when` a pure condition and let `owed act` carry the
instruction.
**Don't:** don't smuggle instructions into the condition ("when you should
run the linter…") — a row whose condition contains its act gets obeyed
without the consult, which is the defect the table exists to prevent.

**Do:** before adding a row, check whether an existing row already owns the
same owed act, and merge instead of adding.
**Don't:** don't merge rows that merely fire together — shared firing shapes
are legal overlap; only a shared owed act forces the merge.
