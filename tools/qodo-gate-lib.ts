// qodo-gate-lib — the pure decision core of the Qodo severity gate (no I/O).
//
// The driver (qodo-gate.ts) posts `/agentic_review`, polls, and fetches the two Qodo
// data sources; every judgment about what those sources mean lives here so it is
// testable against captured fixtures without touching gh or the TrueForge API.
//
// Two Qodo sources, joined by finding title (ADR-0016):
//   - inline comments (GET .../pulls/<pr>/comments) carry SEVERITY, in a shields.io
//     badge URL (`/badge/High-...`), plus the finding title and its "Agent Prompt".
//   - the summary comment (GET .../issues/<pr>/comments, author ~ qodo) carries
//     RESOLUTION — `🐞 Bugs (N)` and a per-finding `✓ Resolved` marker.
// Severity is absent from the summary and resolution is absent from the inline
// badge (its alt is the recommendation strength, static across re-reviews), so
// neither source alone answers "is an open finding High or above?".

/** A severity is gating ("High or above") when it is neither Low nor Medium. */
const NON_GATING = new Set(['low', 'medium']);

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

const BUG_COUNT_RE = /🐞 Bugs \((\d+)\)/g;
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
 * (b) still open per the summary. A finding the summary does not mention is treated
 * as open — the conservative choice, since silence is not a resolution.
 */
export function openGatingFindings(inline: readonly InlineFinding[], summary: Summary): InlineFinding[] {
  const resolvedTitles = new Set(
    summary.findings.filter((f) => f.resolved).map((f) => normalizeTitle(f.title)),
  );
  return inline.filter((f) => f.gating && !resolvedTitles.has(normalizeTitle(f.title)));
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
