---
name: investigate
description: The investigation procedure — fan recon across shapes for anchored signals, freeze a diagnosis forecast before probing, and run every hypothesis test in the sandbox. Open when a session holds a surface to diagnose before proposing a fix.
---

# investigate — the investigation procedure

How a session turns a surface under suspicion into an anchored diagnosis it can
stand behind: it fans recon subagents across investigation shapes to gather
signals, commits a diagnosis forecast before any probe, and tests every
hypothesis in the sandbox. The diagnosis this produces is what a candidate fix is
filed against, through the `corpus-write` skill.

Load this when the work in hand is a surface to diagnose. The root fans the
investigation; the shapes and the forecast are its own, and no subagent it
dispatches diagnoses the surface or proposes the fix.

## Fan recon across shapes

Dispatch a **recon** subagent for each investigation shape the surface warrants,
one shape per dispatch. Paste the template below verbatim, then append the frozen
description of the surface under investigation and the one shape assigned. Recon
gathers and reports anchored signals; the diagnosis is the dispatching root's,
formed from the signals recon hands back. The template travels with the dispatch,
so recon never depends on a file resolving outside this skill.

> You are a recon investigator. A description of the surface under investigation
> follows this template, with one investigation shape assigned. Your task is to
> gather and report observed signals — never to diagnose the cause or propose a
> fix.
>
> **Investigation shapes.** Work only the shape you are assigned. Each is a
> parameterization of the same role; a second shape is a second dispatch.
> - **log-reader** — read the emitted logs and traces for anomalies: error
>   signatures, their onset and ordering, and the first divergence from a healthy
>   baseline.
> - **config-differ** — compare configuration state across surfaces, or against a
>   known-good reference, and report each divergence.
> - **dependency-checker** — check the declared upstream and downstream
>   dependencies for reachability, and read their utilization and saturation
>   against the limits each declares.
>
> Treat the names above as shapes, not a catalog to concretize: describe what you
> observe in the terms the surface presents, and do not narrow a shape to a
> specific mechanism, component, or service.
>
> **What to return.** Return a summary of the signals you observed, each with its
> anchor — the log reference, the configuration location, the dependency reading. You
> hand findings to the dispatching root, which files them; you keep no ledger of
> your own.
>
> **Do:** report the signals you observed, each anchored to where you observed it.
> **Don't:** don't diagnose or propose a fix — recon observes; diagnosis and the
> drafting of any candidate belong to the root that dispatched you.
>
> **Do:** stay within the investigation shape you were assigned.
> **Don't:** don't branch into another shape's territory — hand back what your
> shape found, and let the root dispatch the next shape.

**Do:** dispatch a recon subagent per shape, and freeze the surface description
into each dispatch.
**Don't:** don't fold two shapes into one dispatch; a shape blurred with another
returns signals anchored to neither, and no dispatch owns the gap.

**Do:** form the diagnosis yourself from the anchored signals recon returns.
**Don't:** don't let a recon subagent diagnose or propose the fix — observation
and diagnosis are separate roles, and Article 3 keeps them in separate parties.

## Freeze the forecast before probing

Before any probe runs, record a **diagnosis forecast** into the work product on
the branch — the diagnosis the signals predict, and the reading that would confirm
or refute it — and freeze it as a dated prediction. The probe then tests a
prediction registered ahead of its result, not one fitted to it; the frozen
forecast is a dated record a later reader checks against the probe's reading to
see whether the diagnosis was called before the probe or after.

Recon's signals are observations of the surface as it stands, and the forecast is
built from them — they precede it by design. What the forecast must precede is the
**probe**: the hypothesis test whose result, seen first, would let the diagnosis
be fitted to it. An observation reads what already holds; a probe runs the
experiment the frozen forecast predicts.

**Do:** freeze the forecast before the probe runs — a diagnosis and the reading
that would falsify it, dated where it is written.
**Don't:** don't record the forecast after reading the probe; a prediction fitted
to the result it was meant to test proves nothing about the investigation.

## Probe in the sandbox

Run every hypothesis test in the sandbox, against a provisioned copy of the
surface — never against the live surface itself (Article 5). A probe confirms or
refutes the frozen forecast; a reading that refutes it returns the investigation
to recon or to another forecast, not to a fix.

**Do:** run every probe in the sandbox, and read it against the frozen forecast.
**Don't:** don't touch the live surface to test a hypothesis; a speculative test
on the live surface is the harm the sandbox exists to hold off.
