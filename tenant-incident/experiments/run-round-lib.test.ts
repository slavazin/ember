// Tests for run-round-lib — the pure core. Every rule the round runner leans on (spec
// validation, run expansion, grade-line parsing, ledger folding, rendering) is exercised
// here so the I/O shell in run-round.ts can stay thin. Run via `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRoundSpec,
  specAdvisories,
  expandRuns,
  parseScore,
  parseReportMeta,
  foldRoundToLedgerRows,
  measuredResults,
  measuredLedgerRows,
  quantile,
  renderLedgerRows,
  renderRoundReport,
  LEDGER_COLUMNS,
  type RoundSpec,
  type RunResult,
  type PlannedRun,
} from './run-round-lib.ts';

const GOOD_SPEC = `
round: 0
corpus_tag: corpus/v0
description: Cold baseline.
scenarios:
  - class: pool-exhaustion
    surface: a
    role: anchor
    runs: 3
    expect: fired-off-map
  - class: pool-exhaustion
    surface: b
    role: positive-probe
    runs: 1
    expect: fired-off-map
`;

test('parseRoundSpec accepts a well-formed spec and coerces types', () => {
  const { spec, errors } = parseRoundSpec(GOOD_SPEC);
  assert.deepEqual(errors, []);
  assert.ok(spec);
  assert.equal(spec.round, 0);
  assert.equal(spec.corpus_tag, 'corpus/v0');
  assert.equal(spec.scenarios.length, 2);
  assert.equal(spec.scenarios[0]!.runs, 3);
  assert.equal(spec.scenarios[0]!.role, 'anchor');
});

test('parseRoundSpec reports every problem, not just the first', () => {
  const bad = `
round: -1
corpus_tag: v0
scenarios:
  - class: Pool_Exhaustion
    surface: aa
    role: proberr
    runs: 0
    expect: maybe
`;
  const { spec, errors } = parseRoundSpec(bad);
  assert.equal(spec, null);
  assert.ok(errors.length >= 6, `expected many errors, got ${errors.length}: ${errors.join('; ')}`);
  assert.ok(errors.some((e) => e.includes('round')));
  assert.ok(errors.some((e) => e.includes('corpus_tag')));
  assert.ok(errors.some((e) => e.includes('role')));
  assert.ok(errors.some((e) => e.includes('expect')));
});

test('parseRoundSpec rejects a duplicate (class, surface) pair', () => {
  const dup = `
round: 1
corpus_tag: corpus/v1
scenarios:
  - class: pool-exhaustion
    surface: a
    role: anchor
    runs: 1
    expect: applied
  - class: pool-exhaustion
    surface: a
    role: control
    runs: 1
    expect: considered-not-applicable
`;
  const { spec, errors } = parseRoundSpec(dup);
  assert.equal(spec, null);
  assert.ok(errors.some((e) => e.includes('duplicate')));
});

test('parseRoundSpec rejects a multi-character surface', () => {
  const wide = `
round: 0
corpus_tag: corpus/v0
scenarios:
  - class: pool-exhaustion
    surface: ab
    role: anchor
    runs: 1
    expect: fired-off-map
`;
  const { spec, errors } = parseRoundSpec(wide);
  assert.equal(spec, null);
  assert.ok(errors.some((e) => e.includes('surface') && e.includes('single lowercase letter')));
});

test('specAdvisories warns on tag/round mismatch and a probe without a control', () => {
  const spec: RoundSpec = {
    round: 1,
    corpus_tag: 'corpus/v2',
    scenarios: [{ class: 'pool-exhaustion', surface: 'c', role: 'positive-probe', runs: 3, expect: 'applied' }],
  };
  const notes = specAdvisories(spec);
  assert.ok(notes.some((n) => n.includes('corpus/v2')));
  assert.ok(notes.some((n) => n.includes('probe every promotion')));
});

test('expandRuns produces one run per replicate with derived branch and label', () => {
  const { spec } = parseRoundSpec(GOOD_SPEC);
  const runs = expandRuns(spec!);
  assert.equal(runs.length, 4); // 3 + 1
  assert.equal(runs[0]!.branch, 'run/0/pool-exhaustion-a/1');
  assert.equal(runs[2]!.label, 'pool-exhaustion-a#3');
  assert.equal(runs[3]!.scenarioName, 'pool-exhaustion-b');
});

test('parseScore reads the SCORE line, coercing steps to a number and gates to strings', () => {
  const stdout = [
    'grade: report=x.md',
    'grade: steps=7  (method: frontmatter (steps:))',
    'SCORE steps=7 pool_metrics=PASS datastore_ruled_out=PASS latch_walk=FAIL',
  ].join('\n');
  const s = parseScore(stdout);
  assert.ok(s);
  assert.equal(s.steps, 7);
  assert.equal(s.gates.pool_metrics, 'PASS');
  assert.equal(s.gates.latch_walk, 'FAIL');
});

test('parseScore returns null when no SCORE line is present', () => {
  assert.equal(parseScore('grade: nothing here\n'), null);
});

test('parseReportMeta reads steps, disposition, and forecast_hit from frontmatter', () => {
  const report = `---
steps: 12
disposition: applied
forecast_hit: true
---
# Diagnosis
body
`;
  const meta = parseReportMeta(report);
  assert.equal(meta.steps, 12);
  assert.equal(meta.disposition, 'applied');
  assert.equal(meta.forecast_hit, true);
});

test('parseReportMeta ignores an invalid disposition and missing frontmatter', () => {
  assert.deepEqual(parseReportMeta('no frontmatter here'), {});
  const bad = parseReportMeta('---\ndisposition: nonsense\n---\n');
  assert.equal(bad.disposition, undefined);
});

test('quantile does type-7 interpolation', () => {
  assert.equal(quantile([5], 0.5), 5);
  assert.equal(quantile([4, 6], 0.5), 5); // half-step median
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
});

// A small helper to build a RunResult without the ceremony of a full run.
function mkResult(run: PlannedRun, over: Partial<RunResult>): RunResult {
  return {
    run,
    status: 'graded',
    steps: null,
    gradePass: null,
    gates: {},
    disposition: null,
    forecastHit: null,
    reportPath: null,
    reportIsFixture: false,
    note: '',
    ...over,
  };
}

test('foldRoundToLedgerRows folds replicate stats, dispositions, and detects false-fire', () => {
  const spec: RoundSpec = {
    round: 1,
    corpus_tag: 'corpus/v1',
    scenarios: [
      { class: 'pool-exhaustion', surface: 'c', role: 'positive-probe', runs: 3, expect: 'applied' },
      { class: 'upstream', surface: 'b', role: 'control', runs: 1, expect: 'considered-not-applicable' },
    ],
  };
  const runs = expandRuns(spec);
  const poolRuns = runs.filter((r) => r.scenarioName === 'pool-exhaustion-c');
  const controlRun = runs.find((r) => r.scenarioName === 'upstream-b')!;

  const results: RunResult[] = [
    mkResult(poolRuns[0]!, { steps: 4, gradePass: true, disposition: 'applied', forecastHit: true }),
    mkResult(poolRuns[1]!, { steps: 6, gradePass: true, disposition: 'applied', forecastHit: false }),
    mkResult(poolRuns[2]!, { steps: 5, gradePass: false, disposition: 'applied', forecastHit: true }),
    // The control READ applied where its pre-registration expected considered-not-applicable
    // — a false-fire, the over-generalization the rule bar guards against.
    mkResult(controlRun, { steps: 9, gradePass: true, disposition: 'applied', forecastHit: false }),
  ];

  const rows = foldRoundToLedgerRows(spec, results);
  assert.equal(rows.length, 2);

  const pool = rows[0]!;
  assert.equal(pool.class, 'pool-exhaustion');
  assert.equal(pool.steps_median, '5');
  assert.equal(pool.steps_iqr, '4.5..5.5');
  assert.equal(pool.grade_pass, '2/3');
  assert.equal(pool.forecast_hit, '2/3');
  assert.deepEqual(pool.applied, ['pool-exhaustion-c#1', 'pool-exhaustion-c#2', 'pool-exhaustion-c#3']);
  assert.deepEqual(pool.false_fire, []); // expected applied -> no false-fire

  const control = rows[1]!;
  assert.deepEqual(control.applied, ['upstream-b#1']);
  assert.deepEqual(control.false_fire, ['upstream-b#1']); // applied where cna was expected
});

test('foldRoundToLedgerRows yields n/a stats for an ungraded (blocked) scenario', () => {
  const spec: RoundSpec = {
    round: 0,
    corpus_tag: 'corpus/v0',
    scenarios: [{ class: 'poison-message', surface: 'a', role: 'novelty', runs: 2, expect: 'fired-off-map' }],
  };
  const runs = expandRuns(spec);
  const results = runs.map((r) => mkResult(r, { status: 'blocked' }));
  const rows = foldRoundToLedgerRows(spec, results);
  assert.equal(rows[0]!.steps_median, 'n/a');
  assert.equal(rows[0]!.steps_iqr, 'n/a');
  assert.equal(rows[0]!.grade_pass, '0/0');
});

test('measuredResults keeps only real graded runs (excludes fixtures, blocked, error)', () => {
  const spec: RoundSpec = {
    round: 0,
    corpus_tag: 'corpus/v0',
    scenarios: [{ class: 'pool-exhaustion', surface: 'a', role: 'anchor', runs: 4, expect: 'fired-off-map' }],
  };
  const runs = expandRuns(spec);
  const results: RunResult[] = [
    mkResult(runs[0]!, { status: 'graded', steps: 5, gradePass: true, reportIsFixture: false }),
    mkResult(runs[1]!, { status: 'graded', steps: 3, gradePass: true, reportIsFixture: true }), // fixture — excluded
    mkResult(runs[2]!, { status: 'error' }), // failed inject/reset — excluded
    mkResult(runs[3]!, { status: 'blocked' }), // unbuilt — excluded
  ];
  const measured = measuredResults(results);
  assert.equal(measured.length, 1);
  assert.equal(measured[0]!.run.runIndex, 1);
});

test('the runs column reports the folded count, not the planned count (no overstated replicates)', () => {
  const spec: RoundSpec = {
    round: 0,
    corpus_tag: 'corpus/v0',
    scenarios: [{ class: 'pool-exhaustion', surface: 'a', role: 'anchor', runs: 4, expect: 'fired-off-map' }],
  };
  const runs = expandRuns(spec);
  // Four planned; only one survives filtering (the other three were fixtures/errors/blocked).
  const results: RunResult[] = [mkResult(runs[0]!, { status: 'graded', steps: 8, gradePass: true, reportIsFixture: false })];
  const rows = measuredLedgerRows(spec, results);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.runs, 1); // folded from one measured run, not the planned 4
  assert.equal(rows[0]!.steps_median, '8');
});

test('measuredLedgerRows drops scenarios with no measured run (no false baseline from fixtures)', () => {
  const spec: RoundSpec = {
    round: 0,
    corpus_tag: 'corpus/v0',
    scenarios: [
      { class: 'pool-exhaustion', surface: 'a', role: 'anchor', runs: 1, expect: 'fired-off-map' }, // real graded
      { class: 'pool-exhaustion', surface: 'b', role: 'anchor', runs: 1, expect: 'fired-off-map' }, // fixture only
    ],
  };
  const runs = expandRuns(spec);
  const results: RunResult[] = [
    mkResult(runs[0]!, { status: 'graded', steps: 7, gradePass: true, reportIsFixture: false }),
    mkResult(runs[1]!, { status: 'graded', steps: 3, gradePass: true, reportIsFixture: true }),
  ];
  const rows = measuredLedgerRows(spec, results);
  assert.equal(rows.length, 1); // only the real-graded scenario gets a row
  assert.equal(rows[0]!.surface, 'a');
  assert.equal(rows[0]!.steps_median, '7');
});

test('renderLedgerRows emits one pipe-delimited line per row with — for empty lists', () => {
  const spec: RoundSpec = {
    round: 0,
    corpus_tag: 'corpus/v0',
    scenarios: [{ class: 'pool-exhaustion', surface: 'a', role: 'anchor', runs: 1, expect: 'fired-off-map' }],
  };
  const runs = expandRuns(spec);
  const results = [mkResult(runs[0]!, { steps: 20, gradePass: true, disposition: 'fired-off-map' })];
  const rows = foldRoundToLedgerRows(spec, results);
  const rendered = renderLedgerRows(rows);
  assert.match(rendered, /^\| 0 \| corpus\/v0 \| pool-exhaustion \| a \| anchor \| 1 \|/);
  assert.ok(rendered.includes('| — | — |')); // empty applied/cna/false_fire cells
  assert.ok(rendered.includes('pool-exhaustion-a#1')); // fired_off_map cell
});

test('LEDGER_COLUMNS matches the §6 schema order', () => {
  assert.deepEqual([...LEDGER_COLUMNS], [
    'round', 'corpus_tag', 'class', 'surface', 'role', 'runs',
    'steps_median', 'steps_IQR', 'grade_pass', 'forecast_hit',
    'applied[]', 'cna[]', 'fired_off_map[]', 'false_fire[]',
  ]);
});

test('renderRoundReport always states the human gate and never instructs a merge', () => {
  const { spec } = parseRoundSpec(GOOD_SPEC);
  const runs = expandRuns(spec!);
  const results = runs.map((r) => mkResult(r, { status: 'skipped' }));
  const rows = foldRoundToLedgerRows(spec!, results);
  const report = renderRoundReport(spec!, results, rows, {
    specPath: 'rounds/round-0.yml',
    mode: 'plan',
    corpusCommit: null,
    advisories: [],
    prerequisiteNotes: [],
  });
  assert.ok(report.includes('Human gate (STOP)'));
  assert.ok(report.includes('never merges'));
  assert.ok(!/\bgit merge\b/.test(report));
});
