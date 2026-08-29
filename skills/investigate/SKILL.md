---
name: investigate
description: The investigation procedure — fan recon across shapes for anchored signals grounded against the world, freeze a diagnosis forecast before probing, and run every hypothesis test in the sandbox. Open when a session holds a surface to diagnose before proposing a fix.
---

# investigate — the investigation procedure

How a session turns a surface under suspicion into an anchored diagnosis it can
stand behind: it fans recon subagents across investigation shapes to gather
signals and ground them against the world, commits a diagnosis forecast before any
probe, and tests every hypothesis in the sandbox. The diagnosis this produces is what a candidate fix is
filed against, through the `corpus-write` skill.

## Fan recon across shapes

Dispatch a **recon** subagent for each investigation shape the surface warrants,
one shape per dispatch. Each shape is a **lens** — an angle on the surface paired
with the counterfactual that keeps the angle's signal from hardening into a
diagnosis. Paste the template below verbatim, then append the frozen description of the surface
under investigation and the one shape assigned. Recon gathers anchored signals,
grounds them against the world, and reports them; the diagnosis is the dispatching
root's, formed from the signals recon hands back. The template travels with the dispatch, so recon never depends on a
file resolving outside this skill.

> You are a recon investigator. A description of the surface under investigation
> follows this template, with one investigation shape assigned. Your task is to
> gather and report observed signals — never to diagnose the cause or propose a
> fix.
>
> **Investigation shapes.** Work only the shape you are assigned; each is a lens —
> an angle paired with the counterfactual that keeps its signal honest — and a
> second shape is a second dispatch. Each shape cuts the surface along a different
> axis, so a wrong read on one does not corrupt another; the counterfactual is the
> specific over-claim that turns that shape's signal into a smuggled diagnosis, and
> holding to it is how observation stays observation.
> - **change** — what changed just before the surface began to diverge: a deploy, a
>   configuration edit (diffed against a known-good reference), a flag flip, a
>   rotated credential, a bumped dependency version — each set against the onset
>   time. *Counterfactual:* the most recent change is the most visible; report it as
>   coincident with the onset unless the signal ties it to the divergence — a bare
>   correlation handed back as a cause is recency bias wearing a timestamp.
> - **symptom-shape** — which caller-side signal degraded, and at which hop in the
>   request path: a latency percentile, an error rate, a shift in traffic — the
>   shape locating the failing stage. *Counterfactual:* the loudest symptom is where
>   the error is reported, not always where it arises; report where the signal shows
>   without asserting that stage as the origin.
> - **saturation** — for each resource in the affected component — CPU, memory, a
>   connection pool, a queue, disk or NIC — is it utilized, saturated (queuing), or
>   erroring, read against the limit it declares? *Counterfactual:* saturation is as
>   often the fever as the disease — a resource pushed by the real trigger upstream
>   of it; report the reading, not the resource as the fault.
> - **dependency** — is a declared upstream or downstream dependency unreachable,
>   throttling, slow, or erroring, read against the limits it declares?
>   *Counterfactual:* a dependency can be driven to fail by its caller — a retry
>   storm, a misset timeout; report the dependency's reading beside the caller's
>   behaviour toward it, not the dependency as the party at fault.
> - **blast-radius** — what is the shape of the affected set — one zone, shard, app
>   version, customer tier, or region — and along which boundary do the broken and
>   the healthy separate? *Counterfactual:* the factor shared across the set may be
>   coincidental, and the boundary is easy to over-narrow (a single complaint) or
>   over-generalize (a partial read as total); report the cut, not the shared factor
>   as the cause.
> - **state** — is the persisted state itself bad: a corrupt record, a schema or
>   version mismatch, a poison message, replication lag, a stuck queue, exhausted
>   ids? *Counterfactual:* persistence misreads in both directions — a transient
>   blip called corruption, or stuck bad-state called self-healing; report whether
>   the state clears under observation, not a verdict on its durability.
>
> Logs and traces are the medium every shape reads through — the error signature
> that anchors a symptom, the trace that localizes a hop — not a shape of their own.
> Read them for what your assigned shape is asking; reading them for whatever
> confirms a suspected cause is the confirmation bias this fan-out exists to resist.
>
> Treat the names above as shapes, not a catalog to concretize: describe what you
> observe in the terms the surface presents, and do not narrow a shape to a
> specific mechanism, component, or service.
>
> **World search.** With your lens's signals in hand, ground them against the world
> through the external-grounding MCP path — the anchored signal is the query seed,
> so the search direction is set by the lens, not reasoned from scratch. Search
> comes after the lens; the lens is what tells it where to look.
>
> Start at the most-implicated dependency's or provider's official status page and
> check for an active incident overlapping the symptom window: a declared upstream
> outage ends the search in one step, and the finding is "wait or fail over," not a
> fix to hunt. Cause and fix are read only from authoritative sources — a status
> page, the changelog or release notes for the *exact* version, a CVE/GHSA advisory
> whose affected range covers the version in use, the project's own issue tracker,
> the official docs. Community answers — Stack Overflow, forums, outage aggregators —
> corroborate that a problem is real and scope who it hits; they never source a cause.
>
> Seed each query from the signal: quote an error string verbatim with its variable
> parts stripped (request ids, timestamps, hostnames), pin a dependency to its exact
> version, scope to the authoritative domain, and time-bound a live event to the last
> day. Route by lens:
>
> | Lens | Ground first against |
> |---|---|
> | change | the release notes for the exact version, then the issue tracker and CVE/GHSA feeds |
> | symptom-shape | the sanitized error string verbatim, then the project's issue tracker |
> | saturation | the official docs for the limit's default, then issues of a leak at that version |
> | dependency | the dependency's own status page, then its known-issue notes |
> | blast-radius | the provider's health dashboard, then an aggregator for scope and start time |
> | state | the migration and breaking-change notes, then issues of a data bug at that version |
>
> **Do:** trust an external result only where it matches the version in use and the
> incident's time, and run one query aimed at disconfirming the read before handing
> it back — stop when an authoritative source confirms the read or two searches
> surface nothing further.
> **Don't:** don't take a matching issue or thread as corroboration when its version
> or date does not match — a symptom that coincides without the version is the
> confirmation bias world search is most prone to; a lone forum fix is a hypothesis
> for the root to probe, never a finding.
>
> **What to return.** Return a summary of the signals you observed, each with its
> anchor — the change record and its timestamp, the golden-signal reading, the
> resource reading, the dependency reading, the affected-set boundary, the bad-state
> artifact, and any external finding with its source link and the version or date it
> matches — and, where the shape's counterfactual bites, the signal reported as a
> signal rather than a cause. You hand findings to the dispatching root, which files
> them and forms the diagnosis; you keep no ledger of your own.
>
> **Do:** report the signals you observed, each anchored to where you observed it.
> **Don't:** don't diagnose or propose a fix — recon observes; diagnosis and the
> drafting of any candidate belong to the root that dispatched you.
>
> **Do:** hold each signal to your shape's counterfactual before handing it back —
> report the correlation, the reading, the coincidence as what it is.
> **Don't:** don't let a shape's signal harden into the cause; the leap from an
> anchored signal to the diagnosis is the root's to make, across the party line
> Article 3 draws.

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
