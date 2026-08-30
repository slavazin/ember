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

## Corpus reachability (invariant)

**The corpus is ensured reachable before any corpus read.** Every `/corpus/…` path
this skill reads — the shape-matched store records the boot consults (the rule,
case, and belief records behind a fired hook) and the planning latch table —
resolves through a repo-root symlink the sandbox does not carry by default, and the
sandbox is recycled after an idle interval, dropping a corpus provisioned once at
boot while the harness re-clones only the skills. So reachability is an **invariant
re-ensured before each corpus-touching read**, never a boot-once step: discharge it
with an idempotent guard that no-ops when the corpus already resolves and self-heals
when a recycle has dropped it.

    # Provision /corpus at turn time. The ember origin and the corpus ref are resolved in a
    # priority order, because the sandbox carries no ambient handle to either at a turn-time exec
    # on TrueForge v0.1.4: AGENT_GIT_SKILLS (the base64 {name,url,path,ref} list) is passed only to
    # the one-shot sandbox-init exec that clones the skills, so a turn-time read of it is empty and
    # the hardcoded defaults carry the clone. Order —
    #   origin: EMBER_ORIGIN, else this skill's own url in AGENT_GIT_SKILLS (init only), else the
    #           ember repository;
    #   ref:    EMBER_CORPUS_REF, else this skill's own ref in AGENT_GIT_SKILLS (init only), else main.
    # A round freezes a corpus/v{k} tag by setting EMBER_CORPUS_REF in the guard's exec env; the
    # AGENT_GIT_SKILLS reads self-pin to the skill's registration ref only where they resolve (a
    # harness that persists that env, or a run of this guard during sandbox init), so they are a
    # best-effort hint, never the load-bearing pin. Clone into a scratch path and swap it in only
    # once the checkout succeeds, so an interrupted prior run leaves no partial /corpus behind;
    # every step is chained, so a failure publishes no links.
    # The guard tests BOTH published roots — /corpus and the tenant /tenant-incident/corpus —
    # so a partial provisioning (one link present, the other dropped or never made) re-heals
    # instead of reading as done and failing the tenant read.
    { [ -e /corpus/README.md ] && [ -e /tenant-incident/corpus/README.md ]; } || {
      _tf_skills=$(printf %s "${AGENT_GIT_SKILLS:-}" | base64 -d 2>/dev/null || printf '[]') &&
      _tf_origin="${EMBER_ORIGIN:-$(printf %s "$_tf_skills" | jq -r --arg n session '([.[]|select(.name==$n).url]+[.[].url]|map(select(.!=null)))[0] // empty')}" &&
      _tf_origin="${_tf_origin:-https://github.com/slavazin/ember.git}" &&
      _tf_ref="${EMBER_CORPUS_REF:-$(printf %s "$_tf_skills" | jq -r --arg n session '([.[]|select(.name==$n).ref]+[.[].ref]|map(select(.!=null)))[0] // empty')}" &&
      _tf_ref="${_tf_ref:-main}" &&
      rm -rf /opt/tf/corpus-src.tmp &&
      git clone --no-checkout --depth 1 --filter=blob:none --branch "$_tf_ref" "$_tf_origin" /opt/tf/corpus-src.tmp &&
      git -C /opt/tf/corpus-src.tmp sparse-checkout set corpus tenant-incident/corpus &&
      git -C /opt/tf/corpus-src.tmp checkout &&
      rm -rf /opt/tf/corpus-src && mv /opt/tf/corpus-src.tmp /opt/tf/corpus-src &&
      ln -sfn /opt/tf/corpus-src/corpus /corpus &&
      ln -sfn /opt/tf/corpus-src/tenant-incident /tenant-incident
    }

The sparse set is `corpus/` **plus** `tenant-incident/corpus/`, and it excludes
`tenant-incident/scenarios/`: the scenario is the environment, and an agent that can
read the scenario reads the mechanism and the fix instead of investigating them —
the environment supplies evidence, never the answer. The sparse set materializes
only those two subtrees, so `/tenant-incident/scenarios` never resolves. This
mirrors the harness's own per-sandbox skill self-heal.

**Do:** re-ensure reachability with the idempotent guard before each corpus read —
a no-op when both corpus roots resolve, a self-heal when a recycle has dropped it.
**Don't:** don't provision the corpus once at boot and treat it as durable — the
idle recycle drops the provisioned corpus while re-cloning the skills, so a
boot-once step reads an empty `/corpus` on a later turn.

**Do:** keep the sparse set scoped to `corpus/` plus `tenant-incident/corpus/`.
**Don't:** don't widen the sparse set to `tenant-incident/scenarios/` — pulling the
scenario into the agent's reach contaminates the diagnosis with the answer.

**Do:** freeze a round on a `corpus/v{k}` tag by setting `EMBER_CORPUS_REF` to it in
the guard's exec environment — the clone reads that ref, so the store indexes the boot
consults are the ones the frozen tag holds.
**Don't:** don't lean on `AGENT_GIT_SKILLS` to carry the pin at a turn-time read —
v0.1.4 passes it only to the sandbox-init step, so a turn-time read is empty and the
ref falls back to `main`; a round that must freeze a tag sets `EMBER_CORPUS_REF`.

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
4. **Consult the shape-matched stores.** Against the work-shape declared at
   Orient, open each store index whose stage-one key routes on it: the `rules`
   index for a duty whose `fires-when` matches the presentation in hand, the
   `cases` index for a settled constraint whose summary matches, the `beliefs`
   index for a world-claim the work would depend on. Open the record behind any
   hook that fires and apply from the record — the duty, the constraint, the
   priced claim — following each store index's own read protocol, and record each
   consulted entry as the consultation happens (below). A merged rule's duty
   reaches the work only when the index is opened before the diagnosis, so this
   consultation precedes recon.
5. **Walk the planning latches.** Poll each row of `corpus/latches/planning.md`
   against the work in hand and discharge the owed act of every row that fires;
   leave the walk's `latch-walk:` line in the work product (format and cautions:
   [/corpus/latches/README.md](/corpus/latches/README.md)).

**Do:** declare the work-shape before opening any store — the shape is what the
indexes and latch rows route on.
**Don't:** don't open stores at random ahead of a declared shape; an unrouted read
is the scan the indexes exist to replace.

**Do:** open every store index whose key matches the declared shape before the
diagnosis begins, and apply from the record it opens, never from the index line.
**Don't:** don't defer the store indexes past the diagnosis or fold them into
recon — an unconsulted rule is unreachable knowledge, silent until a miss pays for
it, and the corpus-carried learning the boot exists to recover never arrives.

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
