# SCHEMA — vocabulary term

Terms live in `terms.md`, one block per term, alphabetical. A draft term is
proposed in the same pull request as the second anchored use that qualifies
it.

## Term block

```markdown
## <term>
- **means:** <one sentence, in words the term's consumers already hold>
- **not:** <the neighboring concept this term must not be confused with,
  and what that concept is called instead>
- **anchors:** <the two-plus independent uses that earned admission —
  entry IDs or git-reachable references>
```

## Inherited latches

- **Hook:** the term string itself — its appearance in any condition or
  entry is the activation; no routing field is authored.
- **Revisit trigger:** divergence — two admitted entries using the term for
  different concepts re-opens it, and the disposition is a split.
- **Wiring edges:** every condition and entry using the term; the edge set
  is derivable by search and is never hand-listed.
- **Floor gate:** lint checks block shape (means / not / anchors present).
  Residue: whether uses actually conform to `means` is judgment.
- **Retirement condition:** zero references from conditions or admitted
  entries — derivable; the retirement is human-performed.

## Do / Don't

**Do:** define for latching — `means` written in the presentation words a
consumer holds before the concept has helped them, one sentence.
**Don't:** don't write an essay; a term needing paragraphs is a decision or
belief wearing a term's clothes — admit the entry and have the term cite it.

**Do:** fill `not:` with the term's real confusion boundary — the
neighboring concept a reasonable reader would reach for.
**Don't:** don't pad it with distinctions nobody would draw; a vacuous
boundary teaches nothing and dilutes the real one.

**Do:** wait for two independently anchored uses before proposing.
**Don't:** don't pre-mint a taxonomy ahead of instances — classes invented
before their cases are priming, not observation, and they bend every later
observation toward themselves.

**Do:** on divergence, split into two terms, each re-anchored to its own
uses.
**Don't:** don't average divergent uses into one vaguer definition — a
definition loose enough to cover both meanings routes neither.
