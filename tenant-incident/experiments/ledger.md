# Delta ledger — the demo artifact

Append-only, git-checkpointed (Constitution Art. 12). One row per (round × class ×
surface), replicate stats folded in. This is what the demo reads: the step-count curve
bending on the positive probes and staying flat on the controls, checkpointed in public
git history.

The schema is the round strategy's §6. Rows are produced by
[run-round.ts](/tenant-incident/experiments/run-round.ts) (`--emit-ledger`) and appended,
never edited — a frozen row amended in place stops being evidence (Art. 9). The column set
is defined once in [run-round-lib.ts](/tenant-incident/experiments/run-round-lib.ts)
(`LEDGER_COLUMNS`), so the producer and this header cannot drift.

## Columns

- **round · corpus_tag** — the round index and the frozen ref every run in it booted.
- **class · surface · role** — the scenario and its learnability role in the round matrix.
- **runs** — replicate count for this (class × surface).
- **steps_median · steps_IQR** — the demo metric, folded across replicates (IQR as
  `q1..q3`). A warm round of a promoted class reads a fraction of its cold baseline.
- **grade_pass** — `k/n`: how many replicates passed the scenario's required `grade.sh`
  gate (exit 0). A floor, not a judge (§4).
- **forecast_hit** — `k/n`: how many replicates confirmed the frozen diagnosis forecast in
  the sandbox probe. A rising rate across rounds is learning the step count alone misses.
- **applied[] · cna[] · fired_off_map[]** — the per-run close dispositions. An entry
  `applied` on its positive probe and `considered-not-applicable` on its control is the
  corpus working — the clean read on transfer.
- **false_fire[]** — runs that read `applied` where the pre-registration expected otherwise
  (a control, most often). The over-generalization defect the rule bar guards against; a
  single false-fire sends the promotion back to the slow loop (§6).

## Ledger

The table is empty until round 0 runs on the real harness. R0 establishes the cold
baseline; R1 is the first warm round the delta is read from. Both are pre-registered under
[rounds/](/tenant-incident/experiments/rounds).

| round | corpus_tag | class | surface | role | runs | steps_median | steps_IQR | grade_pass | forecast_hit | applied[] | cna[] | fired_off_map[] | false_fire[] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
