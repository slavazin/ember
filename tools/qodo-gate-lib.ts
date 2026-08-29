// qodo-gate-lib — the pure decision core of the Qodo severity gate (no I/O).
//
// The driver (qodo-gate.ts) posts `/agentic_review`, polls, and fetches the two Qodo
// data sources; every judgment about what those sources mean lives here so it is
// testable against captured fixtures without touching gh or the TrueForge API.
//
// Two Qodo sources, joined by finding title (ADR-0017):
//   - inline comments (GET .../pulls/<pr>/comments) carry SEVERITY, in a shields.io
//     badge URL (`/badge/High-...`), plus the finding title and its "Agent Prompt".
//   - the summary comment (GET .../issues/<pr>/comments, author ~ qodo) carries
//     RESOLUTION — `🐞 Bugs (N)` and a per-finding `✓ Resolved` marker.
// Severity is absent from the summary and resolution is absent from the inline
// badge (its alt is the recommendation strength, static across re-reviews), so
// neither source alone answers "is an open finding High or above?".

/** A severity is gating ("High or above") when it is neither Low nor Medium. */
const NON_GATING = new Set(['low', 'medium']);

/** The exact trusted Qodo principal. A substring match (e.g. /qodo/i) is spoofable — a
 * commenter whose login merely contains "qodo" could supply a forged verdict or findings. */
export const QODO_BOT_LOGIN = 'qodo-code-review[bot]';

/** True only for the exact Qodo bot login — never a name fragment. */
export function isQodoBot(login: string | undefined): boolean {
  return login === QODO_BOT_LOGIN;
}

// The verdict's bug-count line — the ONE contract the completeness check and the parser both
// key on, defined once so they can never diverge: a body accepted as a complete verdict is
// exactly one `parseSummary` can read a non-null count from. (Two separate matchers — one
// emoji-optional here, one emoji-required in the parser — let an "accepted" verdict parse to
// bugCount:null and slip through as a false clean.) Qodo emits the 🐞-prefixed form.
const BUG_COUNT_PATTERN = '🐞 Bugs \\((\\d+)\\)';

/** True only for a COMPLETE Qodo code-review verdict from the exact bot — the title plus an
 * actual bug count in the exact form `parseSummary` reads. Excludes "updated up to the latest
 * commit" notices and in-progress (title-only) bodies, so the gate never mistakes a
 * placeholder — or a body it cannot parse — for a clean verdict. */
export function isQodoVerdictComment(login: string | undefined, body: string): boolean {
  return isQodoBot(login) && /Code Review by Qodo/.test(body) && new RegExp(BUG_COUNT_PATTERN).test(body);
}

/** A Qodo inline finding: severity + title from the inline comment, plus its anchor. */
export interface InlineFinding {
  title: string;
  severity: string; // the badge word, lowercased: high | medium | low | critical | …
  gating: boolean; // severity is High or above
  agentPrompt: string; // the fenced "Agent Prompt" block, or '' if none
  path: string | undefined;
  line: number | undefined;
}

/** A summary-comment finding: title + whether Qodo has marked it resolved. */
export interface SummaryFinding {
  title: string;
  resolved: boolean;
}

export interface Summary {
  bugCount: number | null; // open-bug count from `🐞 Bugs (N)`; null if not found
  findings: SummaryFinding[];
}

export type GateAction = 'clean' | 'remediate' | 'exhausted';

export interface GateDecision {
  action: GateAction;
  openHigh: InlineFinding[]; // open findings that are High or above
  round: number; // review rounds triggered so far, including the current one
  maxRounds: number; // max remediation spawns allowed
}

/** True when a badge word denotes High or above (so a future `Critical` gates too). */
export function isGatingSeverity(severity: string): boolean {
  return !NON_GATING.has(severity.trim().toLowerCase());
}

/** Normalize a finding title for cross-source matching (case/space/punctuation-insensitive). */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strip HTML tags and decode the few entities Qodo emits, for reading the summary body. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

const SEVERITY_BADGE_RE = /img\.shields\.io\/badge\/([A-Za-z]+)-/;
// Title line, e.g. `1\. Adr draft id contradiction <code>🐞 Bug</code> …`
const INLINE_TITLE_RE = /^\s*\d+\\?\.\s+(.+?)(?:\s*<code>|\s*$)/m;
// The fenced block inside <details><summary><strong>Agent Prompt</strong></summary> ``` … ```
const AGENT_PROMPT_RE = /Agent Prompt<\/strong><\/summary>\s*```[^\n]*\n([\s\S]*?)```/;

/** One raw inline comment as returned by the GitHub pulls-comments API. */
export interface RawInlineComment {
  body: string;
  path?: string;
  line?: number | null;
  user?: { login?: string };
}

/**
 * Parse inline comments into findings. Only comments that carry a severity badge are
 * findings; a comment without one is not a Qodo finding and is dropped.
 */
export function parseInlineFindings(comments: readonly RawInlineComment[]): InlineFinding[] {
  const findings: InlineFinding[] = [];
  for (const c of comments) {
    const body = c.body ?? '';
    const sevMatch = SEVERITY_BADGE_RE.exec(body);
    if (sevMatch === null) continue; // not a severity-badged finding
    const severity = (sevMatch[1] as string).toLowerCase();
    const titleMatch = INLINE_TITLE_RE.exec(body);
    const title = titleMatch ? (titleMatch[1] as string).trim() : '';
    const promptMatch = AGENT_PROMPT_RE.exec(body);
    const agentPrompt = promptMatch ? (promptMatch[1] as string).trim() : '';
    findings.push({
      title,
      severity,
      gating: isGatingSeverity(severity),
      agentPrompt,
      path: c.path,
      line: c.line ?? undefined,
    });
  }
  return findings;
}

const BUG_COUNT_RE = new RegExp(BUG_COUNT_PATTERN, 'g'); // same contract isQodoVerdictComment gates on
// A summary finding line, after HTML is stripped: `  3.  ADR draft ID contradiction ✓ Resolved 🐞 Bug …`
const SUMMARY_LINE_RE = /^\s*\d+\.\s+(.+?)\s*(✓ Resolved|Action required|🐞|≡|$)/;

/** Parse the Qodo summary comment for the open-bug count and per-finding resolution. */
export function parseSummary(commentBody: string): Summary {
  const text = stripHtml(commentBody);

  let bugCount: number | null = null;
  for (const m of text.matchAll(BUG_COUNT_RE)) {
    const n = Number(m[1]);
    // Take the largest reported open-bug count across the summary's sections — a
    // section still reporting open bugs must not be masked by a `(0)` elsewhere.
    bugCount = bugCount === null ? n : Math.max(bugCount, n);
  }

  const findings: SummaryFinding[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const m = SUMMARY_LINE_RE.exec(rawLine);
    if (m === null) continue;
    const title = (m[1] as string).trim();
    if (title === '') continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue; // the summary repeats findings across sections
    seen.add(key);
    findings.push({ title, resolved: /✓ Resolved/.test(rawLine) });
  }
  return { bugCount, findings };
}

/**
 * Join the two sources: return the inline findings that are (a) gating severity and
 * (b) still open per the summary. The join is by normalized title, which is lossy — so
 * a gating finding is suppressed as resolved ONLY when the match is unambiguous on both
 * sides (exactly one summary entry and one inline finding share the key) and that summary
 * entry is resolved. Any ambiguity (duplicate/colliding titles either side), an
 * unresolved occurrence, or a title the summary never mentions leaves the finding open —
 * so a resolved item can never hide a distinct open High item, and silence is not a
 * resolution.
 */
export function openGatingFindings(inline: readonly InlineFinding[], summary: Summary): InlineFinding[] {
  const summaryByKey = new Map<string, { count: number; allResolved: boolean }>();
  for (const f of summary.findings) {
    const k = normalizeTitle(f.title);
    const cur = summaryByKey.get(k);
    if (cur) {
      cur.count += 1;
      cur.allResolved = cur.allResolved && f.resolved;
    } else {
      summaryByKey.set(k, { count: 1, allResolved: f.resolved });
    }
  }
  const inlineKeyCount = new Map<string, number>();
  for (const f of inline) {
    const k = normalizeTitle(f.title);
    inlineKeyCount.set(k, (inlineKeyCount.get(k) ?? 0) + 1);
  }
  return inline.filter((f) => {
    if (!f.gating) return false;
    const k = normalizeTitle(f.title);
    const s = summaryByKey.get(k);
    const unambiguous = s !== undefined && s.count === 1 && (inlineKeyCount.get(k) ?? 0) === 1;
    const resolved = unambiguous && s.allResolved;
    return !resolved; // keep open unless the match is unambiguous AND resolved
  });
}

/**
 * The number of gate remediation rounds this loop has run, derived from the tool's own
 * machine-owned trigger markers on the PR — NOT from every `/agentic_review` mention.
 * Counting arbitrary substring matches would let old manual runs or unrelated mentions
 * inflate the round and exhaust the bound on the first cycle.
 */
export function countGateMarkers(commentBodies: readonly string[], marker: string): number {
  return commentBodies.filter((b) => b.includes(marker)).length;
}

/**
 * Flatten `gh api --paginate --slurp` output — an array with one page-array per page —
 * into a single flat array. Paginated `gh api` without `--slurp` emits one JSON value
 * per page, which is not a single parseable document; `--slurp` wraps the pages, and
 * this undoes that wrapping.
 */
export function flattenPages<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) throw new Error('expected an array of pages from gh --slurp');
  const out: T[] = [];
  for (const page of raw) {
    if (Array.isArray(page)) out.push(...(page as T[]));
    else out.push(page as T); // defensive: a non-array page element
  }
  return out;
}

/**
 * The whole gate decision, purely from data. `round` is the number of review rounds
 * triggered so far including the current one; the first round is the original close's
 * gate, each later round a remediation session's close. `maxRounds` caps remediation
 * spawns, so the loop is bounded and cannot recurse forever (Articles 2 & 10 — the
 * gate never merges; it only re-reviews and spawns).
 */
export function classify(openHigh: readonly InlineFinding[], round: number, maxRounds: number): GateDecision {
  const high = [...openHigh];
  if (high.length === 0) return { action: 'clean', openHigh: high, round, maxRounds };
  // round 1 and 2 remediate (maxRounds=2 ⇒ up to 2 remediation spawns); round 3 stops.
  if (round <= maxRounds) return { action: 'remediate', openHigh: high, round, maxRounds };
  return { action: 'exhausted', openHigh: high, round, maxRounds };
}

/**
 * The `user.message` content seeding a remediation session. It tells the saved
 * incident-responder to resume the existing PR branch (its `session` boot already
 * resumes open PRs) and address the open High findings — never to merge.
 */
export function buildRemediationSeed(args: {
  pr: number;
  branch: string;
  openHigh: readonly InlineFinding[];
  round: number;
  maxRounds: number;
}): string {
  const { pr, branch, openHigh, round, maxRounds } = args;
  const lines: string[] = [];
  lines.push(
    `Qodo /agentic_review round ${round} of at most ${maxRounds} on PR #${pr} returned ` +
      `${openHigh.length} open finding(s) of severity High or above. Resume the existing ` +
      `branch \`${branch}\` for that PR — do not open a new PR — boot per the constitution ` +
      `and session skills, address every finding below on that branch, push, and let the ` +
      `close-out re-trigger the review. Do NOT merge; the human merge is the only admitting ` +
      `write (constitution Articles 2 & 10).`,
  );
  lines.push('');
  openHigh.forEach((f, i) => {
    const anchor = f.path ? ` (${f.path}${f.line ? `:${f.line}` : ''})` : '';
    lines.push(`## Finding ${i + 1}: ${f.title || '(untitled)'} [${f.severity}]${anchor}`);
    if (f.agentPrompt) {
      lines.push(f.agentPrompt);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
