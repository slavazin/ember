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
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  frozenCorpusRefBlockers,
  buildSessionRequest,
  buildTurnRequest,
  downloadSandboxFilePath,
  interpretTurnState,
  buildApprovalResume,
  parseSandboxArtifacts,
  selectRunArtifacts,
  LEDGER_HEADER,
  LEDGER_SEPARATOR,
  type PlannedRun,
  type RunResult,
  type ApprovalStatus,
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

/**
 * Grade one diagnosis report and fold it (with its P4 frontmatter) into a graded RunResult.
 * Shared by local and harness modes so both read the score and the close-output contract
 * (steps/disposition/forecast_hit) through the SAME path. Returns a nonMeasured error when
 * grade.sh prints no SCORE line — a grader interrupted or malformed, never a real measurement.
 * May throw if the report file cannot be read; the caller owns any cleanup on that.
 */
function scoreReportToResult(
  run: PlannedRun,
  reportPath: string,
  isFixture: boolean,
  maxSteps: number | null,
  sourceNote: string,
): RunResult {
  const gradeArgs = maxSteps === null ? [reportPath] : [reportPath, '--max-steps', String(maxSteps)];
  const result = runScript(run.scenarioName, 'grade.sh', gradeArgs);
  const score = parseScore(result.stdout);
  // A normal gate failure still prints a SCORE line before exiting non-zero (scenarios
  // README), so an ABSENT SCORE line means the grader was interrupted or malformed — an
  // operational error, not a measurement.
  if (score === null) {
    return nonMeasured(run, 'error', `grade.sh printed no SCORE line (exit ${result.code}) — grader interrupted or malformed; run excluded from measurement`);
  }
  // disposition/forecast_hit are the P4 close-output contract — the pre-registered machine
  // interface the close skill writes into the report frontmatter (MULTI-RUN-STRATEGY §7 P4).
  // When the skill has NOT written them (P4 unhonoured), both read null and the ledger folds
  // them as empty — missing telemetry stays OUT of measurement rather than being invented.
  const meta = parseReportMeta(readFileSync(reportPath, 'utf8'));
  return {
    run,
    status: 'graded',
    steps: score.steps ?? meta.steps ?? null,
    gradePass: result.code === 0,
    gates: score.gates,
    disposition: meta.disposition ?? null,
    forecastHit: meta.forecast_hit ?? null,
    reportPath,
    reportIsFixture: isFixture,
    note: sourceNote,
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
    const source = report.isFixture ? 'graded the scenario fixture (stand-in — not a real run)' : 'graded a run report';
    graded = scoreReportToResult(run, report.path, report.isFixture, maxSteps, source);
    // No SCORE line — reject rather than fold a run with no gates and a fabricated-looking
    // step count into the ledger. Reset still runs so the environment is restored.
    if (graded.status === 'error') {
      info(`[${run.label}] reset (after malformed grade)`);
      runScript(run.scenarioName, 'reset.sh');
      return graded;
    }
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
  corpusRef: string; // the frozen corpus/v{k} tag this round boots (§3, P3)
  approvalPolicy: ApprovalStatus;
}

// Harness HTTP/poll tunables (env-overridable for a slow server). A bounded poll keeps a
// wedged turn from hanging the round; a per-request timeout keeps a stalled fetch from doing
// the same. Defaults: 60s per request, 3s between polls, 200 polls (~10 min per run).
const HARNESS_HTTP_TIMEOUT_MS = Number(process.env.RUN_ROUND_HARNESS_HTTP_TIMEOUT_MS ?? '') || 60_000;
const HARNESS_POLL_INTERVAL_MS = Number(process.env.RUN_ROUND_HARNESS_POLL_INTERVAL_MS ?? '') || 3_000;
const HARNESS_MAX_POLLS = Number(process.env.RUN_ROUND_HARNESS_MAX_POLLS ?? '') || 200;

/**
 * Preflight the harness mode. Returns a config only when the prerequisites are asserted, the
 * environment is OpenAI-only (ISS-003), and the corpus tag is a resolvable FROZEN ref (P3);
 * otherwise it prints what blocks a real round and returns null. This is the gate that keeps
 * an untrusted round from running (§7 prerequisites).
 */
function harnessPreflight(cli: Cli, corpusTag: string, corpusCommit: string | null): HarnessConfig | null {
  const url = process.env.TRUEFORGE_URL ?? '';
  const model = process.env.TRUEFORGE_MODEL ?? '';
  const agent = process.env.TRUEFORGE_AGENT ?? 'incident-responder';
  const rawPolicy = process.env.RUN_ROUND_APPROVAL_POLICY ?? 'allow';
  const blockers: string[] = [];
  if (!cli.prereqsConfirmed) blockers.push('P1/P2/P3/P4 are not asserted — re-run with --prereqs-confirmed once they hold (see the prerequisite list)');
  if (url === '') blockers.push('TRUEFORGE_URL is unset (e.g. http://127.0.0.1:8790)');
  // TRUEFORGE_MODEL ASSERTS the saved agent's model; it does not CONTROL it (a saved agent is
  // booted by name, model baked into its AgentSpec). This checks the operator's asserted value
  // is the proven OpenAI path; the agent's EFFECTIVE model is verified live before the gate
  // lifts (see the RUN_ROUND_HARNESS_WIRED blocker).
  if (model === '') blockers.push('TRUEFORGE_MODEL is unset');
  else if (!model.startsWith('openai/')) blockers.push(`TRUEFORGE_MODEL is ${model} — only openai/* is a proven path (ISS-003; Anthropic identity-linked keys fail)`);
  if (rawPolicy !== 'allow' && rawPolicy !== 'deny') blockers.push(`RUN_ROUND_APPROVAL_POLICY is ${JSON.stringify(rawPolicy)} — must be allow or deny`);

  // P3 (frozen boot): the round must pin a frozen corpus/v{k} tag, and that tag must resolve
  // to a commit (a --tag freeze or a hand-cut tag). The RUNNER side is asserted here; the boot
  // side honouring ref:<tag> is still the unverified TODO (see frozenCorpusRefBlockers).
  blockers.push(...frozenCorpusRefBlockers(corpusTag));
  if (corpusCommit === null) blockers.push(`P3: corpus tag ${corpusTag} does not resolve to a commit — freeze it first (--tag) or cut it by hand before a real round`);

  // The live TrueForge fan-out is now BUILT (harnessRun below), but it has not been verified
  // end-to-end against a running server, and it still leans on contracts that are only
  // confirmed on the runner side. Rather than pass preflight before a live shake-out, the gate
  // stays until a maintainer has run it once and confirmed the path. Specifically deferred to
  // that live check, and the reason the gate stands:
  //   - the boot HONOURS ref:<tag> so measurements are corpus-pinned (P3) — the session
  //     request cannot yet transmit/verify the ref, so a run could read an unpinned corpus;
  //   - the saved agent's EFFECTIVE model is openai/* (TRUEFORGE_MODEL only asserts it, ISS-003);
  //   - the close writes disposition/forecast_hit as the machine-readable P4 frontmatter;
  //   - the per-scenario incident brief and the artifact/patch download path resolve.
  // While the gate stands, NO real run executes, so none of the above can produce a false
  // measurement — set RUN_ROUND_HARNESS_WIRED=1 only after each is confirmed live.
  if (process.env.RUN_ROUND_HARNESS_WIRED !== '1') {
    blockers.push('the live TrueForge fan-out is built but not yet verified end-to-end — deferred live checks: boot honours ref:<tag> (P3, corpus-pinned), the saved agent\'s effective model is openai/* (ISS-003), the P4 close-output frontmatter, and the brief/artifact path. Set RUN_ROUND_HARNESS_WIRED=1 only after a maintainer confirms these against a running server');
  }
  if (blockers.length > 0) {
    info('harness mode is blocked — a real round cannot run until:');
    for (const b of blockers) info(`  - ${b}`);
    return null;
  }
  return { url, model, agent, corpusRef: corpusTag, approvalPolicy: rawPolicy as ApprovalStatus };
}

// ── harness HTTP (only reached past a green preflight) ──

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function tfFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HARNESS_HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tfPostJson(base: string, path: string, body: unknown): Promise<unknown> {
  const res = await tfFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return text === '' ? {} : JSON.parse(text);
}

async function tfGetJson(base: string, path: string): Promise<unknown> {
  const res = await tfFetch(`${base}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return text === '' ? {} : JSON.parse(text);
}

async function tfGetText(base: string, path: string): Promise<string> {
  const res = await tfFetch(`${base}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return text;
}

// The TF create-session / create-turn responses carry an id; be tolerant of a top-level id or
// a nested {session|turn}.id wrapper (the exact envelope is confirmed live before enabling).
function readId(obj: unknown, ...nestKeys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.id === 'string') return rec.id;
  for (const k of nestKeys) {
    const nested = rec[k];
    if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).id === 'string') {
      return (nested as Record<string, unknown>).id as string;
    }
  }
  return null;
}

/**
 * The per-scenario incident BRIEF — the symptom presented to the inspector, deliberately NOT
 * the scenario README (which states the cause; sending it is the SF-2 contamination that
 * turns diagnosis into transcription). The brief is a `brief.md` in the scenario directory.
 * It does not exist yet for the battery (adding it is scenario work, outside this runner), so
 * an absent brief is a clean BLOCK with a clear reason, never a README fallback.
 */
function locateBrief(scenarioName: string): string | null {
  const path = join(SCENARIOS_ROOT, scenarioName, 'brief.md');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

interface HarnessRunDeps {
  cfg: HarnessConfig;
  maxSteps: number | null;
  reportOutDir: string; // where a downloaded diagnosis report is written before grading
}

/**
 * The real fan-out, reached only past harnessPreflight (which refuses unless the maintainer
 * has set RUN_ROUND_HARNESS_WIRED=1 — the live-verification gate). One TrueForge session per
 * run over the REST API; it files to the run's own branch (via the agent's close) and NEVER
 * merges — the corpus-PR merge is the human gate (Art. 2, ADR-0010).
 *
 *   POST {url}/api/v1/sessions             {agent:{name}}                — the saved agent (model/skills/bright-data baked in)
 *   POST {url}/api/v1/sessions/{id}/turns  {input:[{type:user.message}]} — the incident brief (symptom, not README)
 *   poll GET …/turns/{tid} until terminal, resuming an approval-required pause with user.tool_approval
 *   download the close's ```sandbox_artifacts diagnosis report → grade with grade.sh, fold
 *   through the SAME scoreReportToResult path as local mode.
 *
 * Anything that cannot be measured (no brief, an unhandled pause type, a poll timeout, a
 * failed turn, no report artifact) returns blocked/error — never a false measurement.
 */
async function harnessRun(run: PlannedRun, deps: HarnessRunDeps): Promise<RunResult> {
  const { cfg, maxSteps, reportOutDir } = deps;
  const brief = locateBrief(run.scenarioName);
  if (brief === null) {
    return nonMeasured(run, 'blocked', `no incident brief — add tenant-incident/scenarios/${run.scenarioName}/brief.md (the symptom only; the README states the cause and must not be sent). Scenario-authoring work, outside this runner.`);
  }

  try {
    const session = await tfPostJson(cfg.url, '/api/v1/sessions', buildSessionRequest(cfg.agent));
    const sid = readId(session, 'session');
    if (sid === null) return nonMeasured(run, 'error', 'session create returned no id');
    info(`[${run.label}] session ${sid} (corpus ${cfg.corpusRef})`);

    const firstTurn = await tfPostJson(cfg.url, `/api/v1/sessions/${sid}/turns`, buildTurnRequest(brief));
    let tid = readId(firstTurn, 'turn');
    if (tid === null) return nonMeasured(run, 'error', 'turn create returned no id');

    // Poll to terminal, resuming approval pauses. tid tracks the turn a resume continues on
    // (a resume may return a fresh turn id, so re-read it each time).
    let content: string | null = null;
    for (let poll = 0; poll < HARNESS_MAX_POLLS; poll++) {
      const turn = await tfGetJson(cfg.url, `/api/v1/sessions/${sid}/turns/${tid}`);
      const disp = interpretTurnState(turn);
      if (disp.kind === 'done') {
        content = disp.content;
        break;
      }
      if (disp.kind === 'failed') {
        return nonMeasured(run, 'error', `harness turn failed: ${disp.reason}`);
      }
      if (disp.kind === 'action-required') {
        const plan = buildApprovalResume(disp.actions, cfg.approvalPolicy, `unattended round fan-out (policy=${cfg.approvalPolicy}); the human gate is the corpus-PR merge, not tool approval (ADR-0010)`);
        if (plan.unhandledTypes.length > 0) {
          return nonMeasured(run, 'error', `harness turn paused on an unhandled action type(s): ${plan.unhandledTypes.join(', ')} — only tool.approval_required has a confirmed resume contract; wire the others once observed live`);
        }
        if (plan.input.length === 0) {
          return nonMeasured(run, 'error', 'harness turn requires an action but there was nothing to resume (no tool_call ids)');
        }
        const resumed = await tfPostJson(cfg.url, `/api/v1/sessions/${sid}/turns`, { stream: false, input: plan.input });
        tid = readId(resumed, 'turn') ?? tid;
        // Let the server advance past the pause before re-polling, so the SAME action is not
        // read (and re-approved) on the next iteration. The precise resume/re-poll semantics
        // are confirmed at live-verification (the RUN_ROUND_HARNESS_WIRED gate).
        await sleep(HARNESS_POLL_INTERVAL_MS);
        continue;
      }
      await sleep(HARNESS_POLL_INTERVAL_MS);
    }
    if (content === null) {
      return nonMeasured(run, 'error', `harness turn did not reach a terminal state within ${HARNESS_MAX_POLLS} polls — excluded from measurement`);
    }

    // Retrieve the emitted diagnosis report to grade. The format-patch (the deposit candidate
    // for the slow loop) is noted but not merged here.
    const artifacts = parseSandboxArtifacts(content);
    const { reportPath: sandboxReport, patchPath } = selectRunArtifacts(artifacts);
    if (sandboxReport === null) {
      return nonMeasured(run, 'error', `harness run emitted no diagnosis report artifact (${artifacts.length} artifact(s) found${patchPath ? `, incl. patch ${patchPath}` : ''}) — nothing to grade`);
    }

    // Persist both artifacts under a deterministic per-run directory so they survive the round.
    const runOutDir = join(reportOutDir, run.scenarioName, String(run.runIndex));
    mkdirSync(runOutDir, { recursive: true });

    const reportText = await tfGetText(cfg.url, downloadSandboxFilePath(sid, tid, sandboxReport));
    const localReport = join(runOutDir, 'diagnosis.md');
    writeFileSync(localReport, reportText);

    // Retrieve and PERSIST the format-patch too — it is the deposit CANDIDATE the slow loop
    // adjudicates; keeping only its sandbox path (which the report never renders) would strand
    // it. Its target is the run's OWN branch run/{round}/{scenario}/{n} (§3), applied host-side
    // by the deposit helper at the slow loop. The runner never pushes and never merges (Art. 2).
    let depositNote = '';
    if (patchPath !== null) {
      const patchText = await tfGetText(cfg.url, downloadSandboxFilePath(sid, tid, patchPath));
      const localPatch = join(runOutDir, 'deposit.patch');
      writeFileSync(localPatch, patchText);
      depositNote = `; deposit candidate persisted to ${relToRepo(localPatch)} (target branch ${run.branch}; applied host-side at the slow loop, never by the runner)`;
      info(`[${run.label}] deposit candidate → ${relToRepo(localPatch)} (branch ${run.branch})`);
    }

    return scoreReportToResult(run, localReport, false, maxSteps, `graded the harness diagnosis report (downloaded from the TrueForge sandbox)${depositNote}`);
  } catch (e) {
    return nonMeasured(run, 'error', `harness run threw: ${(e as Error).message}`);
  }
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
    const cfg = harnessPreflight(cli, spec.corpus_tag, corpusCommit);
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
      // Downloaded diagnosis reports land under --out when given, else an ephemeral temp dir.
      const reportOutDir = cli.outDir !== null ? join(cli.outDir, 'harness-reports') : mkdtempSync(join(tmpdir(), 'run-round-harness-'));
      // Runs are independent (frozen tag + per-run branch, §3) — fan them out concurrently.
      results = await Promise.all(runs.map((r) => harnessRun(r, { cfg, maxSteps: cli.maxSteps, reportOutDir })));
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
