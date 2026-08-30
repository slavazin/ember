---
name: implement
description: The remediation procedure — bind a fix to the frozen diagnosis, freeze an acceptance check before trialing it, prove the fix in the sandbox against that check, and land it only through the human merge. Open by default once investigate has named an in-estate cause to resolve.
---

# implement — the remediation procedure

How a session turns an anchored diagnosis into a verified fix it can propose. It
is the default step once the `investigate` skill has frozen a diagnosis: the
session binds the remediation to the diagnosed cause, freezes the reading that
would show the incident resolved before it trials anything, proves the fix in the
sandbox against that reading, and lets the fix reach the estate only through the
human merge. The learning the incident teaches is a separate deposit the `close`
skill files through `corpus-write`; this skill resolves the incident, not the
corpus.

## Bind the remediation to the diagnosed cause

The remediation targets the cause the frozen diagnosis names, at the lever that
cause turns on — not the loudest symptom, and not a resource the diagnosis
reported as driven rather than driving. `investigate` froze a diagnosis; the fix
is filed against it, so a fix aimed elsewhere is a fix for an incident that was
not diagnosed.

**Do:** aim the remediation at the diagnosed cause and the lever that cause turns
on.
**Don't:** don't remediate the loudest symptom when the diagnosis names a
different cause — quieting the symptom while the cause stands leaves the incident
live under a calmer surface.

## Take the smallest change that moves the cause

State the remediation as the minimal change at the diagnosed lever — the change
decoupled from the surface it lands on, no wider than the diagnosis warrants. A
fix that widens into a rewrite carries risk the incident did not ask for; a
workaround that routes around the cause without moving it — capacity added beside
a saturated resource, an error masked while the bad state it reads still stands —
leaves the cause to recur.

**Do:** take the smallest change at the diagnosed lever that resolves the cause.
**Don't:** don't mask the cause with a workaround that leaves it live, and don't
widen the fix past what the diagnosis warrants — either trades a bounded
resolution for standing risk.

## When the cause has no in-estate lever

Remediation is the default, and the default is bounded by reach. A diagnosis whose
cause lies outside the estate — an upstream provider fault grounded against the
world (Article 6) — has no code or configuration change in reach that moves it.
There the resolution is the escalation and the bounded local mitigation the
diagnosis warrants — a buffer against the external fault, not a fix to a cause the
estate does not own — and the incident closes on the diagnosis and that
mitigation.

**Do:** remediate by default when the diagnosis names an in-estate lever.
**Don't:** don't force an in-estate fix onto a cause the estate does not own — an
external fault dressed with a local change masks the real cause and reads as a
resolution that resolved nothing.

## Freeze the acceptance check before the trial

Before the fix runs anywhere, record an **acceptance check** into the work product
on the branch and freeze it as a dated prediction: the reading that would show the
incident resolved — the caller-side symptom cleared and the diagnosed cause's own
reading returned to healthy under the condition that provoked it. The trial then
tests a criterion registered ahead of its result, not one fitted to whatever the
trial shows.

The cause reading is the load-bearing half. A symptom can quiet because the
provocation eased rather than because the fix moved anything, so a check that reads
only the symptom passes over a fix that changed nothing. The check reads the lever
the diagnosis named — the resource off saturation, the bad state cleared, the
reverted change absent — beside the symptom.

**Do:** freeze the acceptance check before the trial — the resolved-state reading,
dated where it is written, keyed on the diagnosed cause and not the symptom alone.
**Don't:** don't accept a fix on the symptom quieting alone; a symptom that
subsides while the cause reading still shows the fault is the incident waiting to
recur, not a resolution.

## Trial in the sandbox

Run the candidate fix against a provisioned copy of the surface in the sandbox,
never against the live surface (Article 5), and read the result against the frozen
acceptance check. Re-provoke the surface under the fix — replay the load, the
message, the condition that drove the incident — because a fix trialed against a
quiet surface proves only that it does no harm at rest, not that it resolves the
incident under the condition that caused it.

A trial that meets the check is a fix ready to propose. A trial that refutes it
returns the work to another remediation candidate, or to `investigate` for a
re-diagnosis — never forward to a resolution the trial did not show.

**Do:** trial every fix in the sandbox against a re-provoked copy of the surface,
and read it against the frozen acceptance check.
**Don't:** don't touch the live surface to test a fix, and don't carry a fix
forward on a trial that did not re-provoke the incident — a speculative change to
the live surface is the harm the sandbox exists to hold off, and a fix unproven
against the provoking condition is a guess.

## Land the fix only through the human merge

The remediation's durable effect reaches the estate only through the human merge:
the agent proposes, no agent writes to the live surface, and no agent merges its
own fix (Articles 2 and 3; ADR-0018). The fix leaves the sandbox the way any
sandbox write does — the agent commits it and emits it as a formatted patch
(`git format-patch`), the harness retrieves that patch through its file-download
API, and off the host a human applies it with `git am` in an isolated worktree off
`origin/main`, pushes the branch, and opens a pull request whose merge is the
adjudicating write. This is ADR-0009's patch-out shape: the in-session approval
gates the emit, and the merge admits the fix. The sandbox holds no push credential
and opens no pull request itself.

This proposal is the incident's resolution, not the learning deposit. The fix that
resolves this incident and the corpus entry a future incident of the class
consults are two writes with two homes: the `close` skill files the learning
through `corpus-write`, signed as a corpus deposit with its `Incident-*` trailers;
the remediation carries no corpus-deposit signature, so an operational fix is never
read as a learning entry where the delta is read out of git history (Article 12).
The host path that carries the fix is therefore separate from the one that carries
a deposit: the deposit helper (`tools/patch-to-pr.sh`) admits only fully-signed
corpus commits and refuses anything else, and it is not weakened to carry an
unsigned fix.

**Residue:** the host side of this path is carried out by hand. The committed host
helper (`tools/patch-to-pr.sh`) automates only the deposit path — it validates
every applied commit as a fully-signed corpus deposit and refuses anything else — so
it does not apply an unsigned operational fix, and an automating helper for the fix
path is a build follow-up (ADR-0018). This is a disclosed floor, not a gap in the
gate (Article 8): the `git am` / push / pull-request steps above are the same
whether a human runs them or a helper does, and the merge stays the only admitting
write either way.

**Do:** propose the verified fix for the human merge, and hand the session to
`close` once the fix is filed.
**Don't:** don't deploy the fix to the live surface or merge it unattended, and
don't sign the remediation as a corpus deposit or route it through the deposit-only
helper — a durable effect that escapes the sandbox without the merge has no gate,
and an operational fix signed as a deposit pollutes the learning delta the deposit
signature exists to make readable.
