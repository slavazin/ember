// run-round-lib — the pure core of the multi-run round runner. Parsing, validation,
// run expansion, grade-line parsing, ledger folding, and report rendering live here,
// with no I/O and no process exit, so every rule is unit-testable. The side effects
// (docker compose, git tagging, the TrueForge REST fan-out) live in run-round.ts and
// call into this module.
//
// The round is the experimental unit (MULTI-RUN-STRATEGY.md §3): a fan-out of N runs
// against ONE frozen corpus tag, adjudicated once by the human slow loop. This module
// turns a round spec (the pre-registration) into a plan, folds the graded runs into the
// §6 delta-ledger schema, and renders the round report — but it never adjudicates and
// never merges. That gate is the human's (Constitution Art. 2).
//
// Prose and identifiers follow /corpus/LANGUAGE.md.

import { load } from 'js-yaml';

// ── The learnability role and the close disposition (the two spec enums) ──
//
// role (MULTI-RUN-STRATEGY.md §4 axis 3): what a scenario is FOR in the round matrix.
// expect: the pre-registered close disposition — the intended outcome, checked against
// the observed disposition after the round (§6). A control that reads `applied` instead
// of `considered-not-applicable` is a false-fire, the over-generalization defect the
// rule bar exists to prevent.
export const ROLES = ['anchor', 'positive-probe', 'control', 'novelty', 'belief-falsifier'] as const;
export type Role = (typeof ROLES)[number];

export const DISPOSITIONS = ['applied', 'considered-not-applicable', 'fired-off-map'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export interface ScenarioSpec {
  class: string;
  surface: string;
  role: Role;
  runs: number;
  expect: Disposition;
  note?: string;
}

export interface RoundSpec {
  round: number;
  corpus_tag: string;
  description?: string;
  scenarios: ScenarioSpec[];
}

// The corpus-tag convention (§3): corpus/v{k}, one frozen ref per round.
export const CORPUS_TAG_RE = /^corpus\/v\d+$/;
// A surface is a single lowercase letter (a/b/c…), keyed on presentation, never cause.
const SURFACE_RE = /^[a-z]$/;
// A class label is kebab-case, matching the scenario directory convention.
const CLASS_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export interface ParseResult {
  spec: RoundSpec | null;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * Parse and validate a round spec. Returns every problem it finds rather than throwing
 * on the first, so a malformed spec reports all its errors at once. A YAML that parses
 * but violates the shape yields `spec: null` and a non-empty `errors`.
 */
export function parseRoundSpec(text: string): ParseResult {
  const errors: string[] = [];
  let doc: unknown;
  try {
    doc = load(text);
  } catch (e) {
    return { spec: null, errors: [`YAML did not parse: ${(e as Error).message}`] };
  }
  if (!isPlainObject(doc)) {
    return { spec: null, errors: ['spec must be a YAML mapping at the top level'] };
  }

  if (!isInteger(doc.round) || (doc.round as number) < 0) {
    errors.push('round must be a nonnegative integer');
  }
  if (typeof doc.corpus_tag !== 'string' || !CORPUS_TAG_RE.test(doc.corpus_tag)) {
    errors.push('corpus_tag must be a string of the form corpus/v<k> (e.g. corpus/v0)');
  }
  if (doc.description !== undefined && typeof doc.description !== 'string') {
    errors.push('description, when present, must be a string');
  }

  const scenarios: ScenarioSpec[] = [];
  const rawScenarios = doc.scenarios;
  if (!Array.isArray(rawScenarios) || rawScenarios.length === 0) {
    errors.push('scenarios must be a non-empty list');
  } else {
    const seen = new Set<string>();
    rawScenarios.forEach((raw, i) => {
      const where = `scenarios[${i}]`;
      if (!isPlainObject(raw)) {
        errors.push(`${where} must be a mapping`);
        return;
      }
      const klass = raw.class;
      const surface = raw.surface;
      const role = raw.role;
      const runs = raw.runs;
      const expect = raw.expect;
      const note = raw.note;

      let classOk = false;
      if (typeof klass !== 'string' || !CLASS_RE.test(klass)) {
        errors.push(`${where}.class must be a kebab-case string (got ${JSON.stringify(klass)})`);
      } else {
        classOk = true;
      }
      let surfaceOk = false;
      if (typeof surface !== 'string' || !SURFACE_RE.test(surface)) {
        errors.push(`${where}.surface must be a single lowercase letter a–z (got ${JSON.stringify(surface)})`);
      } else {
        surfaceOk = true;
      }
      if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) {
        errors.push(`${where}.role must be one of ${ROLES.join(' | ')} (got ${JSON.stringify(role)})`);
      }
      if (!isInteger(runs) || (runs as number) < 1) {
        errors.push(`${where}.runs must be an integer >= 1 (got ${JSON.stringify(runs)})`);
      }
      if (typeof expect !== 'string' || !(DISPOSITIONS as readonly string[]).includes(expect)) {
        errors.push(`${where}.expect must be one of ${DISPOSITIONS.join(' | ')} (got ${JSON.stringify(expect)})`);
      }
      if (note !== undefined && typeof note !== 'string') {
        errors.push(`${where}.note, when present, must be a string`);
      }

      if (classOk && surfaceOk) {
        const key = `${klass}-${surface}`;
        if (seen.has(key)) errors.push(`${where}: duplicate scenario ${key} — a (class, surface) pair may appear once per round`);
        seen.add(key);
      }

      // Collect the scenario only when every field is well-typed. A spec with any error
      // returns spec:null regardless, so this shape is safe to assert once the guards hold.
      const fieldsOk =
        classOk &&
        surfaceOk &&
        typeof role === 'string' &&
        (ROLES as readonly string[]).includes(role) &&
        isInteger(runs) &&
        typeof expect === 'string' &&
        (DISPOSITIONS as readonly string[]).includes(expect) &&
        (note === undefined || typeof note === 'string');
      if (fieldsOk) {
        scenarios.push({
          class: klass as string,
          surface: surface as string,
          role: role as Role,
          runs: runs as number,
          expect: expect as Disposition,
          ...(typeof note === 'string' ? { note } : {}),
        });
      }
    });
  }

  if (errors.length > 0) return { spec: null, errors };
  return {
    spec: {
      round: doc.round as number,
      corpus_tag: doc.corpus_tag as string,
      ...(typeof doc.description === 'string' ? { description: doc.description } : {}),
      scenarios,
    },
    errors: [],
  };
}

/**
 * Soft consistency checks that do not invalidate the spec but are worth surfacing: the
 * strategy binds round k to corpus/v{k} (§3), and the "probe every promotion" rule (§5)
 * wants controls present when positive-probes are. Returned as advisory notes.
 */
export function specAdvisories(spec: RoundSpec): string[] {
  const notes: string[] = [];
  const tagVersion = Number(spec.corpus_tag.replace('corpus/v', ''));
  if (tagVersion !== spec.round) {
    notes.push(`round ${spec.round} runs against ${spec.corpus_tag} — round k conventionally runs corpus/v${spec.round} (§3); intentional only if re-running an older tag`);
  }
  const hasPositiveProbe = spec.scenarios.some((s) => s.role === 'positive-probe');
  const hasControl = spec.scenarios.some((s) => s.role === 'control');
  if (hasPositiveProbe && !hasControl) {
    notes.push('a positive-probe is present with no control — "probe every promotion" (§5) wants both a positive probe and a negative-probe/control for each promoted entry');
  }
  const frontier = spec.scenarios.filter((s) => s.role === 'novelty' || s.role === 'belief-falsifier').length;
  if (frontier > 1) {
    notes.push(`${frontier} frontier scenarios (novelty/belief-falsifier) — the rubric (§5) asks for exactly one per round`);
  }
  return notes;
}

// ── Run expansion ──

export interface PlannedRun {
  round: number;
  scenarioClass: string;
  surface: string;
  role: Role;
  expect: Disposition;
  runIndex: number; // 1-based within the scenario
  totalRuns: number;
  scenarioName: string; // `${class}-${surface}`, the scenario directory basename
  branch: string; // run/{round}/{scenario}/{n} (§3: each run owns a distinct branch)
  label: string; // `${scenarioName}#${runIndex}`, the compact per-run id used in the ledger
}

/**
 * Expand a spec into one PlannedRun per (scenario × replicate). The branch and label are
 * derived deterministically so the pre-registration and the report name the same runs.
 */
export function expandRuns(spec: RoundSpec): PlannedRun[] {
  const runs: PlannedRun[] = [];
  for (const s of spec.scenarios) {
    const scenarioName = `${s.class}-${s.surface}`;
    for (let n = 1; n <= s.runs; n++) {
      runs.push({
        round: spec.round,
        scenarioClass: s.class,
        surface: s.surface,
        role: s.role,
        expect: s.expect,
        runIndex: n,
        totalRuns: s.runs,
        scenarioName,
        branch: `run/${spec.round}/${scenarioName}/${n}`,
        label: `${scenarioName}#${n}`,
      });
    }
  }
  return runs;
}

// ── Grade-line and report-frontmatter parsing ──

export interface ParsedScore {
  steps: number | null;
  gates: Record<string, string>; // e.g. { pool_metrics: 'PASS', datastore_ruled_out: 'FAIL' }
  line: string;
}

/**
 * Parse the single `SCORE …` line grade.sh prints. Shape (scenarios/README):
 *   SCORE steps=<n> pool_metrics=PASS datastore_ruled_out=PASS latch_walk=FAIL
 * The `steps` key is read as a number; every other `k=v` pair is kept as a gate string.
 * Returns null when no SCORE line is present.
 */
export function parseScore(stdout: string): ParsedScore | null {
  const line = stdout.split('\n').find((l) => l.startsWith('SCORE '));
  if (line === undefined) return null;
  const gates: Record<string, string> = {};
  let steps: number | null = null;
  for (const tok of line.slice('SCORE '.length).trim().split(/\s+/)) {
    const eq = tok.indexOf('=');
    if (eq === -1) continue;
    const key = tok.slice(0, eq);
    const value = tok.slice(eq + 1);
    if (key === 'steps') {
      const n = Number(value);
      steps = Number.isFinite(n) ? n : null;
    } else {
      gates[key] = value;
    }
  }
  return { steps, gates, line };
}

export interface ReportMeta {
  steps?: number;
  disposition?: Disposition;
  forecast_hit?: boolean;
}

/**
 * Read the close-time facts a run's diagnosis report declares in its YAML frontmatter:
 * `steps`, `disposition`, and `forecast_hit`. grade.sh already reads `steps` from the
 * same frontmatter; the disposition and forecast come from what the `close` skill writes.
 * Absent or malformed frontmatter yields an empty meta, never a throw.
 */
export function parseReportMeta(text: string): ReportMeta {
  const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(text);
  if (m === null) return {};
  let fm: unknown;
  try {
    fm = load(m[1] ?? '');
  } catch {
    return {};
  }
  if (!isPlainObject(fm)) return {};
  const out: ReportMeta = {};
  if (isInteger(fm.steps)) out.steps = fm.steps as number;
  if (typeof fm.disposition === 'string' && (DISPOSITIONS as readonly string[]).includes(fm.disposition)) {
    out.disposition = fm.disposition as Disposition;
  }
  if (typeof fm.forecast_hit === 'boolean') out.forecast_hit = fm.forecast_hit;
  return out;
}

// ── Run results and ledger folding ──

export type RunStatus = 'graded' | 'blocked' | 'skipped' | 'error';

export interface RunResult {
  run: PlannedRun;
  status: RunStatus;
  steps: number | null;
  gradePass: boolean | null; // grade.sh exit 0 (the required gate passed) — §6 grade_pass
  gates: Record<string, string>;
  disposition: Disposition | null; // observed at close, or null when no report declared one
  forecastHit: boolean | null;
  reportPath: string | null;
  reportIsFixture: boolean; // true when the graded report was the scenario fixture, not a real run
  note: string;
}

export interface LedgerRow {
  round: number;
  corpus_tag: string;
  class: string;
  surface: string;
  role: Role;
  runs: number;
  steps_median: string; // "n/a" when no run graded
  steps_iqr: string; // "q1..q3" or "n/a"
  grade_pass: string; // "k/n"
  forecast_hit: string; // "k/n"
  applied: string[];
  cna: string[];
  fired_off_map: string[];
  false_fire: string[];
}

/** type-7 (linear-interpolation) quantile over an ascending-sorted array. */
export function quantile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0]!;
  const pos = (n - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const frac = pos - lo;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * frac;
}

function fmtNum(n: number): string {
  // Integers stay integers; a half-step median (even replicate count) keeps one decimal.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Fold a round's run results into ledger rows, one per (class × surface), replicate stats
 * folded in (§6). steps_median/IQR come from the graded runs' step counts; grade_pass and
 * forecast_hit are k/n fractions; the disposition buckets carry the per-run labels. A
 * false-fire is a run that read `applied` where its pre-registration expected otherwise —
 * the control-violation the rule bar guards against.
 */
export function foldRoundToLedgerRows(spec: RoundSpec, results: readonly RunResult[]): LedgerRow[] {
  const byScenario = new Map<string, RunResult[]>();
  for (const r of results) {
    const key = r.run.scenarioName;
    const list = byScenario.get(key);
    if (list) list.push(r);
    else byScenario.set(key, [r]);
  }

  const rows: LedgerRow[] = [];
  for (const s of spec.scenarios) {
    const scenarioName = `${s.class}-${s.surface}`;
    const group = byScenario.get(scenarioName) ?? [];

    const steps = group.map((r) => r.steps).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const gradeCounted = group.filter((r) => r.gradePass !== null);
    const gradePassed = gradeCounted.filter((r) => r.gradePass === true).length;
    const forecastCounted = group.filter((r) => r.forecastHit !== null);
    const forecastHit = forecastCounted.filter((r) => r.forecastHit === true).length;

    const applied: string[] = [];
    const cna: string[] = [];
    const firedOffMap: string[] = [];
    const falseFire: string[] = [];
    for (const r of group) {
      if (r.disposition === 'applied') applied.push(r.run.label);
      else if (r.disposition === 'considered-not-applicable') cna.push(r.run.label);
      else if (r.disposition === 'fired-off-map') firedOffMap.push(r.run.label);
      // Over-fire: an entry applied where the pre-registration expected it consulted-and-set-aside
      // (or off-map). A single false-fire invalidates a promotion (§6).
      if (r.disposition === 'applied' && r.run.expect !== 'applied') falseFire.push(r.run.label);
    }

    rows.push({
      round: spec.round,
      corpus_tag: spec.corpus_tag,
      class: s.class,
      surface: s.surface,
      role: s.role,
      runs: s.runs,
      steps_median: steps.length > 0 ? fmtNum(quantile(steps, 0.5)) : 'n/a',
      steps_iqr: steps.length > 0 ? `${fmtNum(quantile(steps, 0.25))}..${fmtNum(quantile(steps, 0.75))}` : 'n/a',
      grade_pass: `${gradePassed}/${gradeCounted.length}`,
      forecast_hit: `${forecastHit}/${forecastCounted.length}`,
      applied,
      cna,
      fired_off_map: firedOffMap,
      false_fire: falseFire,
    });
  }
  return rows;
}

// ── Rendering ──

// The ledger table header (§6 schema). The producer and any hand-append share this one
// definition so the columns never drift.
export const LEDGER_COLUMNS = [
  'round',
  'corpus_tag',
  'class',
  'surface',
  'role',
  'runs',
  'steps_median',
  'steps_IQR',
  'grade_pass',
  'forecast_hit',
  'applied[]',
  'cna[]',
  'fired_off_map[]',
  'false_fire[]',
] as const;

export const LEDGER_HEADER = `| ${LEDGER_COLUMNS.join(' | ')} |`;
export const LEDGER_SEPARATOR = `| ${LEDGER_COLUMNS.map(() => '---').join(' | ')} |`;

function cellList(items: readonly string[]): string {
  return items.length === 0 ? '—' : items.join(', ');
}

/** Render ledger rows as markdown table body lines (no header — the ledger file owns that). */
export function renderLedgerRows(rows: readonly LedgerRow[]): string {
  return rows
    .map((r) =>
      `| ${[
        r.round,
        r.corpus_tag,
        r.class,
        r.surface,
        r.role,
        r.runs,
        r.steps_median,
        r.steps_iqr,
        r.grade_pass,
        r.forecast_hit,
        cellList(r.applied),
        cellList(r.cna),
        cellList(r.fired_off_map),
        cellList(r.false_fire),
      ].join(' | ')} |`,
    )
    .join('\n');
}

export interface ReportContext {
  specPath: string;
  mode: string;
  corpusCommit: string | null; // the commit the corpus tag resolves to, when known
  advisories: string[];
  prerequisiteNotes: string[]; // P1/P2/P3 status lines
}

/**
 * Render the round report: the pre-registration expanded to runs, each run's observed
 * outcome, the folded ledger rows, and the standing human-gate reminder. The report is a
 * read of the round; it makes no adjudication and instructs no merge.
 */
export function renderRoundReport(
  spec: RoundSpec,
  results: readonly RunResult[],
  rows: readonly LedgerRow[],
  ctx: ReportContext,
): string {
  const lines: string[] = [];
  lines.push(`# Round ${spec.round} report — ${spec.corpus_tag}`);
  lines.push('');
  lines.push(`- spec: \`${ctx.specPath}\``);
  lines.push(`- mode: ${ctx.mode}`);
  lines.push(`- corpus tag: ${spec.corpus_tag}${ctx.corpusCommit ? ` (@ ${ctx.corpusCommit})` : ' (not resolved — declared only)'}`);
  if (spec.description) {
    lines.push('');
    lines.push(spec.description.trim());
  }

  if (ctx.advisories.length > 0) {
    lines.push('');
    lines.push('## Advisories');
    for (const a of ctx.advisories) lines.push(`- ${a}`);
  }

  lines.push('');
  lines.push('## Runs');
  lines.push('');
  lines.push('| run | role | expect | status | steps | grade | disposition | forecast | source |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    const grade = r.gradePass === null ? '—' : r.gradePass ? 'pass' : 'fail';
    const disp = r.disposition ?? '—';
    const source = r.reportIsFixture ? 'fixture' : r.reportPath ? 'run-report' : '—';
    lines.push(
      `| ${r.run.label} | ${r.run.role} | ${r.run.expect} | ${r.status} | ${r.steps ?? '—'} | ${grade} | ${disp} | ${r.forecastHit === null ? '—' : r.forecastHit ? 'hit' : 'miss'} | ${source} |`,
    );
  }

  lines.push('');
  lines.push('## Ledger rows (append these to ledger.md)');
  lines.push('');
  lines.push(LEDGER_HEADER);
  lines.push(LEDGER_SEPARATOR);
  lines.push(renderLedgerRows(rows));

  if (ctx.prerequisiteNotes.length > 0) {
    lines.push('');
    lines.push('## Prerequisites');
    for (const n of ctx.prerequisiteNotes) lines.push(`- ${n}`);
  }

  lines.push('');
  lines.push('## Human gate (STOP)');
  lines.push('');
  lines.push(
    'This runner stops here. The slow loop — `promotion-review` over the union of this ' +
      "round's candidate branches, the human adjudicating and merging, then tagging the next " +
      'corpus version — is the human gate (Constitution Art. 2). The runner never merges and ' +
      'never advances the corpus.',
  );
  lines.push('');
  return lines.join('\n');
}
