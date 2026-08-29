// qodo-gate — mechanizes the Article-10 Qodo gate as an optional, bounded, post-close
// loop (ADR-0017). After `close` files a PR, this posts `/agentic_review`, waits for
// Qodo's verdict, and — if any OPEN finding is severity High or above — opens a
// remediation session on the same PR branch via the TrueForge session API. It NEVER
// merges: the human merge stays the sole admitting write (constitution Articles 2 & 10).
//
//   QODO_GATE=on npm run qodo-gate -- --pr=<n> [--max-rounds=<n>] [--dry-run]
//                                     [--repo=<owner/repo>] [--base-url=<tf-url>]
//                                     [--agent=<name>]
//
// Off by default: with QODO_GATE unset it is a no-op, so nothing posts or spawns
// unless the operator enables the toggle. Exit codes: 0 = clean or remediation
// dispatched, 1 = High findings remain after the round cap (surface to human),
// 2 = internal / inconclusive (no verdict).

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type InlineFinding,
  type RawInlineComment,
  buildRemediationSeed,
  classify,
  countGateMarkers,
  flattenPages,
  isQodoBot,
  isQodoVerdictComment,
  openGatingFindings,
  parseInlineFindings,
  parseSummary,
} from './qodo-gate-lib.ts';

const DEFAULT_REPO = 'slavazin/ember';
const DEFAULT_BASE_URL = 'http://localhost:8790';
const DEFAULT_AGENT = 'incident-responder';
const DEFAULT_MAX_ROUNDS = 2;
const TRIGGER = '/agentic_review';
// A hidden marker the gate stamps on its own trigger comments, so the round count reflects
// this loop's cycles — not historical or manual `/agentic_review` posts. Qodo still fires on
// the `/agentic_review` line; the marker is inert to it.
const GATE_MARKER = '<!-- qodo-gate-cycle -->';
const TRIGGER_BODY = `${TRIGGER}\n\n${GATE_MARKER}`;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 360_000; // ~6 min; Qodo is ~1–5 min and variable

function fail(message: string): never {
  process.stderr.write(`qodo-gate: ${message}\n`);
  process.exit(2);
}

function out(message: string): void {
  process.stdout.write(`${message}\n`);
}

interface Args {
  pr: number;
  repo: string;
  baseUrl: string;
  agent: string;
  maxRounds: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    if (eq === -1) fail(`flag ${arg} needs a value as --flag=value`);
    const key = arg.slice(2, eq);
    const value = arg.slice(eq + 1);
    if (value === '') fail(`flag --${key} needs a non-empty value`);
    flags.set(key, value);
  }
  const prRaw = flags.get('pr');
  if (prRaw === undefined) fail('--pr=<n> is required');
  const pr = Number(prRaw);
  if (!Number.isInteger(pr) || pr <= 0) fail(`--pr must be a positive integer (got "${prRaw}")`);

  let maxRounds = DEFAULT_MAX_ROUNDS;
  const envMax = process.env.QODO_GATE_MAX_ROUNDS;
  const maxRaw = flags.get('max-rounds') ?? (envMax !== undefined && envMax !== '' ? envMax : undefined);
  if (maxRaw !== undefined) {
    maxRounds = Number(maxRaw);
    if (!Number.isInteger(maxRounds) || maxRounds < 1) fail(`max-rounds must be a positive integer (got "${maxRaw}")`);
  }

  return {
    pr,
    repo: flags.get('repo') ?? DEFAULT_REPO,
    baseUrl: (flags.get('base-url') ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    agent: flags.get('agent') ?? DEFAULT_AGENT,
    maxRounds,
    dryRun,
  };
}

/** Shell gh in argument-array form (never a shell string), mirroring the repo's git wrapper. */
function gh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (cause) {
    const stderr = (cause as { stderr?: string }).stderr;
    fail(`gh ${args[0] ?? ''} failed: ${stderr ? stderr.trim() : msg(cause)}`);
  }
}

/** GET a paginated list endpoint as one flat typed array. Uses `--slurp` (which wraps each
 * page as an array element) instead of raw `--paginate`, whose concatenated per-page JSON is
 * not a single parseable document — the bug that made multi-page PRs exit inconclusive. */
function ghApiList<T>(path: string): T[] {
  const raw = gh(['api', path, '--paginate', '--slurp']);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(`could not parse JSON from: gh api ${path} --paginate --slurp`);
  }
  return flattenPages<T>(parsed);
}

function msg(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface IssueComment {
  body: string;
  updated_at: string;
  user: { login: string };
}

/** The latest COMPLETE Qodo verdict comment (exact bot, title, and an actual bug count).
 * Authenticating the exact principal stops a spoofed summary; requiring the verdict marker
 * stops an in-progress placeholder or a "…updated up to the latest commit" notice from being
 * read as the verdict. */
function latestQodoSummary(comments: readonly IssueComment[]): IssueComment | undefined {
  const summaries = comments.filter((c) => isQodoVerdictComment(c.user.login, c.body));
  if (summaries.length === 0) return undefined;
  return summaries.reduce((a, b) => (a.updated_at >= b.updated_at ? a : b));
}

async function createRemediationSession(args: Args, seed: string): Promise<string> {
  const sessionRes = await fetch(`${args.baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: { name: args.agent } }),
  });
  if (!sessionRes.ok) fail(`TrueForge session create failed: HTTP ${sessionRes.status} ${await sessionRes.text()}`);
  const session = (await sessionRes.json()) as { id?: string; session?: { id?: string } };
  const sid = session.id ?? session.session?.id;
  if (!sid) fail('TrueForge session create returned no id');

  const turnRes = await fetch(`${args.baseUrl}/api/v1/sessions/${sid}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: false, input: [{ type: 'user.message', content: seed }] }),
  });
  if (!turnRes.ok) fail(`TrueForge turn create failed: HTTP ${turnRes.status} ${await turnRes.text()}`);
  return sid;
}

async function main(argv: string[]): Promise<number> {
  if (process.env.QODO_GATE !== 'on') {
    out('qodo-gate: disabled (set QODO_GATE=on to enable the post-close Qodo gate)');
    return 0;
  }
  const args = parseArgs(argv);

  const branch = gh(['pr', 'view', String(args.pr), '--repo', args.repo, '--json', 'headRefName', '-q', '.headRefName']).trim();
  if (branch === '') fail(`could not resolve the head branch of PR #${args.pr}`);

  // Baseline: the summary comment's updated_at before we re-trigger, so we can tell a
  // fresh verdict from a stale one (Qodo updates its verdict IN PLACE — poll, never
  // watch for a "new review" event).
  const issuesPath = `repos/${args.repo}/issues/${args.pr}/comments`;
  const before = ghApiList<IssueComment>(issuesPath);
  const baseline = latestQodoSummary(before)?.updated_at ?? '';

  if (args.dryRun) {
    out(`qodo-gate: [dry-run] would post "${TRIGGER}" (+ cycle marker) to PR #${args.pr} (${args.repo}) on branch ${branch}`);
  } else {
    gh(['pr', 'comment', String(args.pr), '--repo', args.repo, '--body', TRIGGER_BODY]);
    out(`qodo-gate: posted ${TRIGGER} to PR #${args.pr}; awaiting Qodo verdict…`);
  }

  // Poll the summary comment until its updated_at moves past the baseline (or one first
  // appears). In dry-run, read the current verdict without waiting for a fresh one.
  let summaryComment: IssueComment | undefined;
  let latestComments: IssueComment[] = before;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    latestComments = ghApiList<IssueComment>(issuesPath);
    const candidate = latestQodoSummary(latestComments);
    if (candidate && (args.dryRun || candidate.updated_at > baseline)) {
      summaryComment = candidate;
      break;
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  }
  if (summaryComment === undefined) {
    fail(`no Qodo verdict within ${Math.round(POLL_TIMEOUT_MS / 1000)}s — inconclusive, surface to human`);
  }

  const inlineRaw = ghApiList<RawInlineComment>(`repos/${args.repo}/pulls/${args.pr}/comments`);
  const inline: InlineFinding[] = parseInlineFindings(inlineRaw.filter((c) => isQodoBot(c.user?.login)));
  const summary = parseSummary(summaryComment.body);
  // Defense in depth: a comment accepted as complete must yield a parseable count. If the
  // parser and the completeness check ever diverge, fail inconclusive — never to clean.
  if (summary.bugCount === null) {
    fail('accepted a Qodo verdict with no parseable bug count — inconclusive, surface to human');
  }
  const openHigh = openGatingFindings(inline, summary);

  // Round = this gate's own trigger markers on the PR, not every /agentic_review mention.
  // In dry-run nothing was posted, so add the marker this run would have added.
  const round = countGateMarkers(latestComments.map((c) => c.body), GATE_MARKER) + (args.dryRun ? 1 : 0);

  const decision = classify(openHigh, round, args.maxRounds);
  out(
    `qodo-gate: round ${round}/${args.maxRounds} — bugs=${summary.bugCount ?? '?'}, ` +
      `open High+ findings=${openHigh.length} → ${decision.action}`,
  );

  switch (decision.action) {
    case 'clean':
      out('qodo-gate: no open findings of severity High or above — hand to human for merge.');
      return 0;
    case 'exhausted':
      for (const f of openHigh) out(`  · [${f.severity}] ${f.title || '(untitled)'}${f.path ? ` — ${f.path}` : ''}`);
      out(`qodo-gate: High findings remain after ${args.maxRounds} remediation round(s) — surface to human.`);
      return 1;
    case 'remediate': {
      const seed = buildRemediationSeed({ pr: args.pr, branch, openHigh, round, maxRounds: args.maxRounds });
      if (args.dryRun) {
        out(`qodo-gate: [dry-run] would open a "${args.agent}" remediation session for ${openHigh.length} finding(s):`);
        out(seed);
        return 0;
      }
      const sid = await createRemediationSession(args, seed);
      out(`qodo-gate: opened remediation session ${sid} (agent "${args.agent}") to address ${openHigh.length} finding(s) on ${branch}.`);
      return 0;
    }
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((cause) => {
      process.stderr.write(`qodo-gate: internal error: ${msg(cause)}\n`);
      process.exit(2);
    });
}
