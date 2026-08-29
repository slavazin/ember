// run-round — the multi-run round runner (MULTI-RUN-STRATEGY.md §7 artifact 3).
//
// Given a round spec, it tags/pins the corpus, provisions each scenario, runs N runs in
// parallel each on its own branch, collects each grade.sh SCORE line plus the close
// dispositions, and emits a round report + the delta-ledger rows. It STOPS at the human
// gate (Constitution Art. 2): it never runs `promotion-review`, never merges a candidate
// branch, and never advances the corpus. The slow loop is the human's.
//
// Three modes, ordered by their prerequisites:
//
//   plan   (default) — parse, validate, expand, resolve scenario dirs, render the plan.
//                      No side effects; runnable anywhere, no docker, no harness. This is
//                      the dry-run and the way to check a pre-registration.
//   local            — drive the docker-compose scenarios directly: inject → grade a run
//                      report → reset. Exercises the battery + grading + ledger pipeline
//                      without the harness (fast scenario-authoring shake-out). A run's
//                      diagnosis report comes from --reports-dir; absent that, the
//                      scenario fixture stands in (labeled as a fixture, never a real run).
//   harness          — the real fan-out: N concurrent TrueForge sessions over the REST
//                      API, OpenAI-only (ISS-003). GATED behind the prerequisites P1/P3
//                      (see below); it refuses to run a real round until they are asserted.
//
// The pure core (parsing, folding, rendering) is in run-round-lib.ts and is unit-tested;
// this file is the I/O shell.
//
// Prose follows /corpus/LANGUAGE.md.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRoundSpec,
  specAdvisories,
  expandRuns,
  parseScore,
  parseReportMeta,
  foldRoundToLedgerRows,
  measuredLedgerRows,
  renderRoundReport,
  renderLedgerRows,
  LEDGER_HEADER,
  LEDGER_SEPARATOR,
  type PlannedRun,
  type RunResult,
} from './run-round-lib.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const SCENARIOS_ROOT = join(REPO_ROOT, 'tenant-incident', 'scenarios');

const MODES = ['plan', 'local', 'harness'] as const;
type Mode = (typeof MODES)[number];

function fail(message: string): never {
  process.stderr.write(`run-round: ${message}\n`);
  process.exit(2);
}

function info(message: string): void {
  process.stderr.write(`run-round: ${message}\n`);
}

interface Cli {
  specPath: string;
  mode: Mode;
  reportsDir: string | null;
  outDir: string | null;
  ledgerPath: string;
  maxSteps: number | null;
  tag: boolean;
  prereqsConfirmed: boolean;
  emitLedger: boolean;
}

function parseCli(argv: string[]): Cli {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  const boolFlags = new Set(['tag', 'prereqs-confirmed', 'emit-ledger']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (boolFlags.has(name)) {
        bools.add(name);
      } else {
        const value = argv[i + 1];
        if (value === undefined) fail(`flag --${name} needs a value`);
        flags.set(name, value);
        i++;
      }
    } else {
      positionals.push(arg);
    }
  }
  const specPath = positionals[0];
  if (specPath === undefined) fail('usage: run-round <spec.yml> [--mode plan|local|harness] [--reports-dir DIR] [--out DIR] [--ledger PATH] [--max-steps N] [--tag] [--prereqs-confirmed] [--emit-ledger]');

  const mode = (flags.get('mode') ?? 'plan') as Mode;
  if (!(MODES as readonly string[]).includes(mode)) fail(`unknown mode ${mode} — one of ${MODES.join(' | ')}`);

  let maxSteps: number | null = null;
  const rawMax = flags.get('max-steps');
  if (rawMax !== undefined) {
    const n = Number(rawMax);
    if (!Number.isInteger(n) || n < 0) fail('--max-steps needs a nonnegative integer');
    maxSteps = n;
  }

  return {
    specPath: resolve(specPath),
    mode,
    reportsDir: flags.has('reports-dir') ? resolve(flags.get('reports-dir')!) : null,
    outDir: flags.has('out') ? resolve(flags.get('out')!) : null,
    ledgerPath: flags.has('ledger') ? resolve(flags.get('ledger')!) : join(HERE, 'ledger.md'),
    maxSteps,
    tag: bools.has('tag'),
    prereqsConfirmed: bools.has('prereqs-confirmed'),
    emitLedger: bools.has('emit-ledger'),
  };
}

// ── git / corpus helpers (read-only unless --tag; never push, never merge) ──

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function tagExists(tag: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve — and, under --tag, create — the frozen corpus tag for this round (§3: tag the
 * corpus before the round opens; every run boots that exact ref). Creating a tag is a
 * freeze, not an admission: it never pushes and never merges. Returns the resolved commit,
 * or null when the tag is absent and --tag was not passed.
 */
function resolveCorpusTag(tag: string, create: boolean): string | null {
  if (tagExists(tag)) return git(['rev-parse', tag]);
  if (!create) {
    info(`corpus tag ${tag} does not exist — pass --tag to freeze it at the current corpus HEAD, or create it by hand before a real round`);
    return null;
  }
  const head = git(['rev-parse', 'HEAD']);
  git(['tag', tag, head]);
  info(`created frozen corpus tag ${tag} at ${head} (local only — not pushed)`);
  return head;
}

// ── scenario provisioning (local mode) ──

function scriptPath(scenarioName: string, script: string): string {
  return join(SCENARIOS_ROOT, scenarioName, script);
}

function scenarioExists(scenarioName: string): boolean {
  return existsSync(scriptPath(scenarioName, 'grade.sh'));
}

// Provisioning scripts (inject/reset) drive docker compose and can stall on an environment
// that cannot pull images; a bounded timeout fails them fast rather than hanging the round.
// grade.sh scores a markdown report and does no docker, so it is quick. Overridable via
// RUN_ROUND_SCRIPT_TIMEOUT_MS for a slow builder.
const SCRIPT_TIMEOUT_MS = Number(process.env.RUN_ROUND_SCRIPT_TIMEOUT_MS ?? '') || 120_000;

function runScript(scenarioName: string, script: string, args: string[] = []): { stdout: string; code: number } {
  const path = scriptPath(scenarioName, script);
  try {
    const stdout = execFileSync('bash', [path, ...args], {
      cwd: join(SCENARIOS_ROOT, scenarioName),
      encoding: 'utf8',
      timeout: SCRIPT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), code: err.status ?? 1 };
  }
}

/**
 * Locate a run's diagnosis report. Preference: --reports-dir/<scenario>/<n>.md — a real
 * run's close output. Fallback: the scenario's own fixture, returned with isFixture=true so
 * the report and ledger mark it as a stand-in, never as a graded real run.
 */
function locateReport(run: PlannedRun, reportsDir: string | null): { path: string; isFixture: boolean } | null {
  if (reportsDir !== null) {
    const candidate = join(reportsDir, run.scenarioName, `${run.runIndex}.md`);
    if (existsSync(candidate)) return { path: candidate, isFixture: false };
  }
  const fixture = join(SCENARIOS_ROOT, run.scenarioName, 'fixtures', 'diagnosis-good.md');
  if (existsSync(fixture)) return { path: fixture, isFixture: true };
  return null;
}

// ── run drivers ──

function planRun(run: PlannedRun): RunResult {
  const exists = scenarioExists(run.scenarioName);
  return {
    run,
    status: exists ? 'skipped' : 'blocked',
    steps: null,
    gradePass: null,
    gates: {},
    disposition: null,
    forecastHit: null,
    reportPath: null,
    reportIsFixture: false,
    note: exists ? 'plan only — no run executed' : 'scenario not built (battery expansion pending, §7 artifact 1)',
  };
}

// A non-measured result (blocked/error). Keeps the RunResult shape in one place so the
// many early returns below cannot drift a field.
function nonMeasured(run: PlannedRun, status: 'blocked' | 'error', note: string): RunResult {
  return {
    run,
    status,
    steps: null,
    gradePass: null,
    gates: {},
    disposition: null,
    forecastHit: null,
    reportPath: null,
    reportIsFixture: false,
    note,
  };
}

function localRun(run: PlannedRun, reportsDir: string | null, maxSteps: number | null): RunResult {
  if (!scenarioExists(run.scenarioName)) {
    return nonMeasured(run, 'blocked', 'scenario not built (battery expansion pending, §7 artifact 1)');
  }
  const report = locateReport(run, reportsDir);
  if (report === null) {
    return nonMeasured(run, 'error', 'no diagnosis report — supply --reports-dir/<scenario>/<n>.md or a scenario fixture');
  }

  // Provisioning must succeed for the run to be measured evidence. A failed inject means the
  // scenario was never stood up, so grading a report against no stack is not a real run — it
  // is an error, excluded from the report's measured rows and the ledger. Cleanup still runs.
  info(`[${run.label}] inject`);
  const injected = runScript(run.scenarioName, 'inject.sh');
  if (injected.code !== 0) {
    info(`[${run.label}] reset (after failed inject)`);
    runScript(run.scenarioName, 'reset.sh');
    return nonMeasured(run, 'error', `inject.sh exited ${injected.code} — scenario not provisioned; run excluded from measurement`);
  }

  let graded: RunResult;
  try {
    const gradeArgs = maxSteps === null ? [report.path] : [report.path, '--max-steps', String(maxSteps)];
    const result = runScript(run.scenarioName, 'grade.sh', gradeArgs);
    const score = parseScore(result.stdout);
    // A normal gate failure still prints a SCORE line before exiting non-zero (scenarios
    // README), so an ABSENT SCORE line means the grader was interrupted or malformed — an
    // operational error, not a measurement. Reject it rather than fold a run with no gates
    // and a fabricated-looking step count into the ledger.
    if (score === null) {
      info(`[${run.label}] reset (after malformed grade)`);
      runScript(run.scenarioName, 'reset.sh');
      return nonMeasured(run, 'error', `grade.sh printed no SCORE line (exit ${result.code}) — grader interrupted or malformed; run excluded from measurement`);
    }
    const meta = parseReportMeta(readFileSync(report.path, 'utf8'));
    const source = report.isFixture ? 'graded the scenario fixture (stand-in — not a real run)' : 'graded a run report';
    graded = {
      run,
      status: 'graded',
      steps: score.steps ?? meta.steps ?? null,
      gradePass: result.code === 0,
      gates: score.gates,
      disposition: meta.disposition ?? null,
      forecastHit: meta.forecast_hit ?? null,
      reportPath: report.path,
      reportIsFixture: report.isFixture,
      note: source,
    };
  } catch (e) {
    info(`[${run.label}] reset (after grade error)`);
    runScript(run.scenarioName, 'reset.sh');
    return nonMeasured(run, 'error', `grading threw: ${(e as Error).message}`);
  }

  // A failed reset leaves the environment dirty, which casts doubt on the controlled
  // comparison for the rest of the round (§3). Downgrade the run to error rather than let a
  // measurement from an unrestored environment enter the ledger.
  info(`[${run.label}] reset`);
  const reset = runScript(run.scenarioName, 'reset.sh');
  if (reset.code !== 0) {
    return nonMeasured(run, 'error', `${graded.note}; reset.sh exited ${reset.code} — environment not restored, run excluded from measurement`);
  }
  return graded;
}

// The prerequisites a real (harness) round depends on. plan/local proceed without them; a
// real round cannot. Surfaced in every report and enforced before any harness fan-out.
const PREREQUISITES = [
  'P1 (SF-1) self-driving runs: the inspector must not pause to ask the human which shape to run or whether to finish — invariant framing in investigate/close, or ask_user_question disabled. Without P1 there is no unattended fan-out.',
  'P2 (SF-8) tenant incident/case store under tenant-incident/corpus/: deposits currently land in the layer store; a round without P2 grows the wrong tree.',
  'P3 corpus tagging: confirm ref:<tag> (not only ref:main) boots a frozen corpus, so a round pins a version rather than the moving head.',
  'P4 close-output contract: the close skill must record each entry\'s close disposition and the forecast outcome as `disposition:`/`forecast_hit:` in the run report frontmatter — the runner\'s machine-readable interface (parseReportMeta). Until the skill writes them, the applied/cna/fired_off_map and forecast_hit columns read empty even on real runs.',
];

interface HarnessConfig {
  url: string;
  model: string;
  agent: string;
}

/**
 * Preflight the harness mode. Returns a config only when the prerequisites are asserted and
 * the environment is OpenAI-only (ISS-003); otherwise it prints what blocks a real round and
 * returns null. This is the gate that keeps an untrusted round from running (§7 prerequisites).
 */
function harnessPreflight(cli: Cli): HarnessConfig | null {
  const url = process.env.TRUEFORGE_URL ?? '';
  const model = process.env.TRUEFORGE_MODEL ?? '';
  const agent = process.env.TRUEFORGE_AGENT ?? 'incident-responder';
  const blockers: string[] = [];
  if (!cli.prereqsConfirmed) blockers.push('P1/P2/P3/P4 are not asserted — re-run with --prereqs-confirmed once they hold (see the prerequisite list)');
  if (url === '') blockers.push('TRUEFORGE_URL is unset (e.g. http://127.0.0.1:8790)');
  if (model === '') blockers.push('TRUEFORGE_MODEL is unset');
  else if (!model.startsWith('openai/')) blockers.push(`TRUEFORGE_MODEL is ${model} — only openai/* is a proven path (ISS-003; Anthropic identity-linked keys fail)`);
  // The live fan-out (session/turn/poll/artifact-grade over the TrueForge REST API) is not
  // wired yet: it depends on contracts that do not exist (P2 tenant store, P4 close-output,
  // the per-scenario incident brief and artifact-retrieval path) and cannot be verified here
  // against a live server. Rather than pass preflight and then no-op, harness mode blocks on
  // this until the path is built AND verified — set RUN_ROUND_HARNESS_WIRED=1 only then.
  if (process.env.RUN_ROUND_HARNESS_WIRED !== '1') {
    blockers.push('the live TrueForge fan-out is not wired yet — it lands with P1/P2/P3/P4 and a confirmed server; the maintainer sets RUN_ROUND_HARNESS_WIRED=1 once harnessRun is built and verified end-to-end');
  }
  if (blockers.length > 0) {
    info('harness mode is blocked — a real round cannot run until:');
    for (const b of blockers) info(`  - ${b}`);
    return null;
  }
  return { url, model, agent };
}

/**
 * The real fan-out, reached only past harnessPreflight (which today refuses unless the
 * maintainer has set RUN_ROUND_HARNESS_WIRED=1 — see the preflight). The intended sequence,
 * one TrueForge session per run over the REST API, files to the run's own branch and NEVER
 * merges:
 *   POST {url}/api/v1/sessions             { agent, model, ... }         — model FQN, bright-data preload:true
 *   POST {url}/api/v1/sessions/{id}/turns  { message: <incident brief> } — the scenario's symptom, not its README
 *   poll GET …/turns/{turnId}              until terminal, resuming tool.response_required pauses
 *   download the close's diagnosis report artifact → grade with the scenario grade.sh, then
 *   fold through the SAME parseScore/parseReportMeta path as local mode.
 * The building of this path (brief source, artifact retrieval, branch handling) is the work P1
 * through P4 unblock; it is left unbuilt rather than shipped guessing at contracts that do not
 * exist. If it is entered before being built, it returns an error, never a false measurement.
 */
async function harnessRun(run: PlannedRun, cfg: HarnessConfig, reportsDir: string | null, maxSteps: number | null): Promise<RunResult> {
  void cfg;
  void reportsDir;
  void maxSteps;
  return Promise.resolve(nonMeasured(run, 'error', 'harnessRun is not built — RUN_ROUND_HARNESS_WIRED was set but the live fan-out has not been implemented; build it before enabling'));
}

// ── main ──

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (!existsSync(cli.specPath)) fail(`spec not found: ${cli.specPath}`);

  const { spec, errors } = parseRoundSpec(readFileSync(cli.specPath, 'utf8'));
  if (spec === null) {
    process.stderr.write('run-round: spec is invalid:\n');
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(2);
  }

  const runs = expandRuns(spec);
  const advisories = specAdvisories(spec);

  // Corpus tag: plan mode only reports the tag's resolution; local/harness may freeze it.
  const create = cli.tag && cli.mode !== 'plan';
  const corpusCommit = resolveCorpusTag(spec.corpus_tag, create);

  let results: RunResult[];
  const prerequisiteNotes = cli.mode === 'harness' ? PREREQUISITES : PREREQUISITES.map((p) => `(not blocking in ${cli.mode} mode) ${p}`);

  if (cli.mode === 'plan') {
    results = runs.map(planRun);
  } else if (cli.mode === 'local') {
    // Runs are independent (frozen tag + per-run branch, §3) — fan them out concurrently.
    results = await Promise.all(runs.map((r) => Promise.resolve(localRun(r, cli.reportsDir, cli.maxSteps))));
  } else {
    const cfg = harnessPreflight(cli);
    if (cfg === null) {
      results = runs.map((r) => ({
        run: r,
        status: 'blocked' as const,
        steps: null,
        gradePass: null,
        gates: {},
        disposition: null,
        forecastHit: null,
        reportPath: null,
        reportIsFixture: false,
        note: 'harness preflight failed — see the prerequisite blockers above',
      }));
    } else {
      results = await Promise.all(runs.map((r) => harnessRun(r, cfg, cli.reportsDir, cli.maxSteps)));
    }
  }

  // Only a real graded run is measured evidence: a fixture stands in for pipeline shake-out
  // and is never counted (README promise); a blocked or errored run was not measured. The
  // ledger rows — the "append these" section AND the durable append — are folded from the
  // measured runs alone, and only for scenarios that had one, so a fixture or a failed
  // provisioning can never establish a false baseline.
  const rows = measuredLedgerRows(spec, results);

  const report = renderRoundReport(spec, results, rows, {
    specPath: relToRepo(cli.specPath),
    mode: cli.mode,
    corpusCommit,
    advisories,
    prerequisiteNotes,
  });

  // The report goes to stdout always; to a file when --out is given.
  process.stdout.write(report);
  if (cli.outDir !== null) {
    mkdirSync(cli.outDir, { recursive: true });
    const outPath = join(cli.outDir, `round-${spec.round}-report.md`);
    writeFileSync(outPath, report);
    info(`wrote ${relToRepo(outPath)}`);
  }

  // Ledger append is opt-in (--emit-ledger) and only carries measured rows. The append is the
  // only durable write, and it appends — it never rewrites history (Art. 9, append-only).
  if (cli.emitLedger) {
    const excludedFixtures = results.filter((r) => r.status === 'graded' && r.reportIsFixture).length;
    if (rows.length === 0) {
      info(`--emit-ledger given but no measured run to checkpoint — nothing appended${excludedFixtures > 0 ? ` (${excludedFixtures} fixture-backed run(s) excluded)` : ' (plan/blocked round)'}`);
    } else {
      appendLedger(cli.ledgerPath, rows);
      if (excludedFixtures > 0) info(`excluded ${excludedFixtures} fixture-backed run(s) from the ledger`);
      info(`appended ${rows.length} measured ledger row(s) to ${relToRepo(cli.ledgerPath)}`);
    }
  }
}

function relToRepo(p: string): string {
  const r = p.startsWith(REPO_ROOT) ? p.slice(REPO_ROOT.length + 1) : p;
  return r.split('\\').join('/');
}

/**
 * Append a round's rows to the ledger, creating the file with its header if absent. The
 * ledger is append-only: rows are added under the table, existing rows are never touched.
 */
function appendLedger(ledgerPath: string, rows: ReturnType<typeof foldRoundToLedgerRows>): void {
  if (!existsSync(ledgerPath)) {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, `${LEDGER_HEADER}\n${LEDGER_SEPARATOR}\n`);
  }
  appendFileSync(ledgerPath, `${renderLedgerRows(rows)}\n`);
}

// A small guard so an unresolved rejection surfaces as exit 1, not a silent hang.
main().catch((e) => {
  process.stderr.write(`run-round: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
