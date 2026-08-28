# decisions/ — the case store

**Kind:** ledger. Entries are frozen at admission: superseded or
status-flipped, never edited — typos included.

**Holds:** settled point decisions that constrain future forks: one entry
per adjudicated question, stating the constraint and the facts that would
falsify it.

**Live question:** is this still correct? An entry is contradicted by
currency — a premise on its falsification list reversing, or a constraint it
depends on dissolving — never by disuse.

**Reader and moment:** any session at plan time, scanning the one-line
summaries; the full entry is opened when a summary matches the work at hand.
A summary invites the read — it never substitutes for it, and complying with
a summary alone is a defect on the reader's side.

**Retirement:** a status flip to `superseded` (with a successor pointer) or
`moot` (the decided fork no longer exists). Entries are never deleted; the
history of being wrong is retained on purpose.

**Feeds:** two admitted decisions observed on distinct surfaces are the
warrant floor for a rule — see [../rules/README.md](../rules/README.md).
