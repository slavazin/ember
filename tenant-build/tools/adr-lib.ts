// adr-lib — pure parsing, validation, and query for the build ADR store.
//
// The store is tenant-build/corpus/decisions/ADR-nnnn.md. This module has no CLI and does
// the fs read only in loadCorpus; parse/validate/query are pure so the CLI and the tests
// share one implementation. Frontmatter is parsed through js-yaml under FAILSAFE_SCHEMA —
// every scalar stays a string, so a spec'd format is not hand-rolled (the parse-fidelity
// discipline of tools/INDEX-CONTRACT.md, applied here).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, FAILSAFE_SCHEMA } from 'js-yaml';

export const STATUSES = ['accepted', 'superseded', 'moot', 'converged'] as const;
export type Status = (typeof STATUSES)[number];

// Every frontmatter key the schema declares. A key outside this set is a typo (a dropped
// `supersede:` edge reads as no edge), so an unknown key fails rather than passing silently.
export const KNOWN_KEYS = [
  'id',
  'status',
  'supersedes',
  'superseded-by',
  'converged-into',
  'promoted-to',
  'scopes',
  'related',
  'backfilled',
  'decided',
] as const;

export interface Adr {
  id: string;
  status: Status;
  supersedes?: string;
  supersededBy?: string;
  convergedInto: string[];
  promotedTo?: string;
  scopes: string[];
  related: string[];
  backfilled: boolean;
  decided: string;
  summary: string; // the `# ` title line, without the marker
  file: string; // basename, e.g. ADR-0007.md
}

export interface Problem {
  file: string;
  message: string;
}

const ID_RE = /^ADR-\d{4}$/;
const ENTRY_FILE_RE = /^ADR-\d{4}\.md$/; // exact four digits — never widen to \d+ (loose-acceptance)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Exact admitted-entry filename test — one shape, fixed by the schema. */
export function isEntryFile(name: string): boolean {
  return ENTRY_FILE_RE.test(name);
}

// Read an optional scalar field. Absent (missing or null) returns undefined; a value that is
// present but not a string is a shape error, never silently treated as absent — a dropped edge
// (e.g. `supersedes: [ADR-0001]`) would evade the reciprocity check downstream (partial-contract).
function readScalar(data: Record<string, unknown>, key: string, errors: string[]): string | undefined {
  const v = data[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    errors.push(`${key} must be a scalar string`);
    return undefined;
  }
  return v;
}

// A required scalar: absent is its own error; a present non-string is caught by readScalar. The
// caller distinguishes the two via the returned flag so it never double-reports one bad value.
function readRequiredScalar(
  data: Record<string, unknown>,
  key: string,
  errors: string[],
): { value: string; present: boolean } {
  const raw = data[key];
  const value = readScalar(data, key, errors);
  if (value === undefined) {
    if (raw === undefined || raw === null) errors.push(`${key} is required`);
    return { value: '', present: false };
  }
  return { value, present: true };
}

// The body sections the schema fixes as required. `## Options considered` is intentionally not
// here — it may be omitted for an uncontested decision (its absence is itself signal).
const REQUIRED_SECTIONS = ['Context', 'Decision', 'Consequences', 'Warrant'] as const;

function hasSection(body: string, name: string): boolean {
  return new RegExp(`^##\\s+${name}\\s*$`, 'm').test(body);
}

// A declared list field: an array of non-empty strings, or absent. Anything else — a scalar,
// a nested map, a blank item — is a shape error, not silently coerced (coarse-shape).
function asStringList(v: unknown): { ok: true; list: string[] } | { ok: false; reason: string } {
  if (v === undefined) return { ok: true, list: [] };
  if (!Array.isArray(v)) return { ok: false, reason: 'must be a list' };
  const list: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || item.trim() === '') {
      return { ok: false, reason: 'every item must be a non-empty string' };
    }
    list.push(item.trim());
  }
  return { ok: true, list };
}

function extractSummary(body: string): string {
  for (const line of body.split('\n')) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m && m[1] !== undefined) return m[1];
  }
  return '';
}

/**
 * Parse one entry file's text into an Adr, collecting every shape error found (an id typo and a
 * bad status are both reported, not just the first). A record with any error is still returned
 * best-effort so cross-entry checks can run, but its errors are surfaced.
 */
export function parseAdrFile(file: string, text: string): { adr: Adr; errors: string[] } {
  const errors: string[] = [];
  const m = FRONTMATTER_RE.exec(text);
  if (!m || m[1] === undefined) {
    return { adr: emptyAdr(file), errors: ['no frontmatter block'] };
  }
  const body = text.slice(m[0].length);

  let doc: unknown;
  try {
    doc = load(m[1], { schema: FAILSAFE_SCHEMA });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { adr: emptyAdr(file), errors: [`invalid YAML frontmatter: ${detail}`] };
  }
  const data: Record<string, unknown> =
    doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};

  for (const key of Object.keys(data)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) errors.push(`unknown frontmatter key: ${key}`);
  }

  const idField = readRequiredScalar(data, 'id', errors);
  const id = idField.value;
  if (idField.present && !ID_RE.test(id)) errors.push(`id "${id}" is not canonical ADR-nnnn`);

  const statusField = readRequiredScalar(data, 'status', errors);
  if (statusField.present && !(STATUSES as readonly string[]).includes(statusField.value)) {
    errors.push(`status "${statusField.value}" is not one of ${STATUSES.join(' | ')}`);
  }
  const status = statusField.value as Status;

  const supersedes = readScalar(data, 'supersedes', errors);
  if (supersedes !== undefined && !ID_RE.test(supersedes)) errors.push(`supersedes "${supersedes}" is not canonical`);
  const supersededBy = readScalar(data, 'superseded-by', errors);
  if (supersededBy !== undefined && !ID_RE.test(supersededBy)) {
    errors.push(`superseded-by "${supersededBy}" is not canonical`);
  }

  const convergedInto = collectList(data['converged-into'], 'converged-into', errors);
  for (const cid of convergedInto) if (!ID_RE.test(cid)) errors.push(`converged-into "${cid}" is not canonical`);

  const scopes = collectList(data['scopes'], 'scopes', errors);
  const related = collectList(data['related'], 'related', errors);
  for (const rid of related) if (!ID_RE.test(rid)) errors.push(`related "${rid}" is not a canonical ADR id`);

  const promotedTo = readScalar(data, 'promoted-to', errors);

  const backfillRaw = data['backfilled'];
  let backfilled = false;
  if (backfillRaw !== undefined) {
    if (backfillRaw === 'true') backfilled = true;
    else errors.push('backfilled, when present, must be the literal true');
  }

  const decidedField = readRequiredScalar(data, 'decided', errors);
  const decided = decidedField.value;
  if (decidedField.present && !DATE_RE.test(decided)) errors.push(`decided "${decided}" is not YYYY-MM-DD`);

  const summary = extractSummary(body);
  if (summary === '') errors.push('no `# ` summary line');

  // The required body sections must be present — a summary alone is not a schema-valid entry
  // (an ADR with no Decision or Warrant carries no constraint and no falsification evidence).
  for (const section of REQUIRED_SECTIONS) {
    if (!hasSection(body, section)) errors.push(`missing required section: ## ${section}`);
  }

  const adr: Adr = {
    id,
    status: status,
    ...(supersedes !== undefined ? { supersedes } : {}),
    ...(supersededBy !== undefined ? { supersededBy } : {}),
    convergedInto,
    ...(promotedTo !== undefined ? { promotedTo } : {}),
    scopes,
    related,
    backfilled,
    decided,
    summary,
    file,
  };
  return { adr, errors };
}

function collectList(v: unknown, field: string, errors: string[]): string[] {
  const r = asStringList(v);
  if (!r.ok) {
    errors.push(`${field} ${r.reason}`);
    return [];
  }
  return r.list;
}

function emptyAdr(file: string): Adr {
  return {
    id: '',
    status: 'accepted',
    convergedInto: [],
    scopes: [],
    related: [],
    backfilled: false,
    decided: '',
    summary: '',
    file,
  };
}

export interface LoadResult {
  adrs: Adr[];
  fileErrors: Problem[]; // parse/shape errors, per file
}

/** Read every ADR-nnnn.md in dir, parse each, and collect per-file shape errors. */
export function loadCorpus(dir: string): LoadResult {
  const names = readdirSync(dir).filter(isEntryFile).sort();
  const adrs: Adr[] = [];
  const fileErrors: Problem[] = [];
  for (const name of names) {
    const { adr, errors } = parseAdrFile(name, readFileSync(join(dir, name), 'utf8'));
    adrs.push(adr);
    for (const message of errors) fileErrors.push({ file: name, message });
  }
  return { adrs, fileErrors };
}

/**
 * Cross-entry validation: identity, the supersession pair's reciprocity, and that every
 * cited id resolves. Terminal retirement (moot) carries no successor; only supersession does —
 * the retirement contract is not globalized across lifecycles (lifecycle-overreach).
 */
export function checkCorpus(adrs: Adr[]): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map<string, Adr>();
  for (const a of adrs) if (a.id !== '') byId.set(a.id, a);

  for (const a of adrs) {
    // Identity: the declared id and the filename must be the same canonical record.
    if (a.id !== '' && ID_RE.test(a.id) && a.file !== `${a.id}.md`) {
      problems.push({ file: a.file, message: `filename must equal ${a.id}.md` });
    }

    // Status-conditioned edges.
    if (a.status === 'superseded') {
      if (a.supersededBy === undefined) {
        problems.push({ file: a.file, message: 'status superseded requires superseded-by' });
      }
    } else if (a.supersededBy !== undefined) {
      problems.push({ file: a.file, message: `superseded-by set but status is ${a.status}` });
    }

    if (a.status === 'converged') {
      if (a.convergedInto.length === 0) {
        problems.push({ file: a.file, message: 'status converged requires converged-into' });
      }
    } else if (a.convergedInto.length > 0) {
      problems.push({ file: a.file, message: `converged-into set but status is ${a.status}` });
    }

    // Reciprocity: superseded-by must resolve, and the successor must point back via supersedes.
    if (a.supersededBy !== undefined && ID_RE.test(a.supersededBy)) {
      const succ = byId.get(a.supersededBy);
      if (!succ) problems.push({ file: a.file, message: `superseded-by ${a.supersededBy} resolves to no entry` });
      else if (succ.supersedes !== a.id) {
        problems.push({ file: a.file, message: `${a.supersededBy} does not name ${a.id} in supersedes` });
      }
    }
    // The other direction: supersedes must resolve, and the target must be superseded by this.
    if (a.supersedes !== undefined && ID_RE.test(a.supersedes)) {
      const prev = byId.get(a.supersedes);
      if (!prev) problems.push({ file: a.file, message: `supersedes ${a.supersedes} resolves to no entry` });
      else if (prev.supersededBy !== a.id) {
        problems.push({ file: a.file, message: `${a.supersedes} does not name ${a.id} in superseded-by` });
      }
    }

    // Every cited id (converged-into, related) must resolve — no dangling cross-reference.
    for (const cid of a.convergedInto) {
      if (ID_RE.test(cid) && !byId.has(cid)) {
        problems.push({ file: a.file, message: `converged-into ${cid} resolves to no entry` });
      }
    }
    for (const rid of a.related) {
      if (ID_RE.test(rid) && !byId.has(rid)) {
        problems.push({ file: a.file, message: `related ${rid} resolves to no entry` });
      }
      if (rid === a.id) problems.push({ file: a.file, message: 'related lists the entry itself' });
    }
  }
  return problems;
}

// ── queries ──

const FIELD_SEP = ' · ';

function idSuffix(id: string): number {
  const n = Number.parseInt(id.slice(4), 10);
  return Number.isNaN(n) ? 0 : n;
}

function byIdAsc(a: Adr, b: Adr): number {
  return idSuffix(a.id) - idSuffix(b.id);
}

/** segments(short) is a prefix of segments(long) — segment-aware so `tools` never matches `toolsX`. */
function segPrefix(short: string, long: string): boolean {
  const s = short.replace(/\/+$/, '').split('/');
  const l = long.replace(/\/+$/, '').split('/');
  if (s.length > l.length) return false;
  return s.every((seg, i) => seg === l[i]);
}

export interface IndexFilter {
  status?: Status;
  scope?: string; // browsing filter: match either direction of prefix
  related?: string; // ADRs citing, or cited by, this id
}

/** One line per matching ADR: `id · status · scopes · summary` (summary routes; never obeyable alone). */
export function indexView(adrs: Adr[], filter: IndexFilter = {}): string[] {
  let rows = [...adrs].sort(byIdAsc);
  if (filter.status) rows = rows.filter((a) => a.status === filter.status);
  if (filter.scope) {
    const q = filter.scope;
    rows = rows.filter((a) => a.scopes.some((s) => segPrefix(q, s) || segPrefix(s, q)));
  }
  if (filter.related) {
    const id = filter.related;
    rows = rows.filter(
      (a) =>
        a.id === id ||
        a.related.includes(id) ||
        a.supersedes === id ||
        a.supersededBy === id ||
        a.convergedInto.includes(id),
    );
  }
  return rows.map(
    (a) =>
      `${a.id}${FIELD_SEP}${a.status}${FIELD_SEP}${a.scopes.length ? a.scopes.join(', ') : '(none)'}${FIELD_SEP}${a.summary}`,
  );
}

export interface LineageEdge {
  relation: string; // supersedes | superseded-by | converged-into | related
  adr: Adr;
}

export interface Lineage {
  target?: Adr;
  outbound: LineageEdge[];
  inbound: LineageEdge[];
  missing: boolean;
}

/** The lineage graph for one id: its outbound edges, plus every entry that cites it inbound. */
export function relatedView(adrs: Adr[], id: string): Lineage {
  const byId = new Map<string, Adr>();
  for (const a of adrs) if (a.id !== '') byId.set(a.id, a);
  const target = byId.get(id);
  if (!target) return { outbound: [], inbound: [], missing: true };

  const outbound: LineageEdge[] = [];
  const push = (relation: string, refId: string | undefined) => {
    if (refId === undefined) return;
    const adr = byId.get(refId);
    if (adr) outbound.push({ relation, adr });
  };
  push('supersedes', target.supersedes);
  push('superseded-by', target.supersededBy);
  for (const c of target.convergedInto) push('converged-into', c);
  for (const r of target.related) push('related', r);

  const inbound: LineageEdge[] = [];
  for (const a of [...adrs].sort(byIdAsc)) {
    if (a.id === id) continue;
    if (a.supersedes === id) inbound.push({ relation: 'supersedes', adr: a });
    if (a.supersededBy === id) inbound.push({ relation: 'superseded-by', adr: a });
    if (a.convergedInto.includes(id)) inbound.push({ relation: 'converged-into', adr: a });
    if (a.related.includes(id)) inbound.push({ relation: 'related', adr: a });
  }
  return { target, outbound, inbound, missing: false };
}

export interface ScopeHit {
  path: string;
  adrs: Adr[];
}

export type GitRunner = (args: string[]) => string | undefined;

/**
 * The branch's changed paths for the default `adr scopes` run: files differing from the
 * merge-base with origin/main, unioned with untracked files. A newly created governed file is
 * untracked until staged, and the diff-time hook is meant to run during exactly that review — so
 * omitting untracked paths would blind the hook to the new file. Git-runner is injected for testing.
 */
export function discoverChangedPaths(runGit: GitRunner): string[] {
  const lines = (out: string | undefined): string[] =>
    out === undefined ? [] : out.split('\n').map((s) => s.trim()).filter((s) => s !== '');
  const base = runGit(['merge-base', 'HEAD', 'origin/main'])?.trim() || 'HEAD';
  const tracked = lines(runGit(['diff', '--name-only', base]));
  const untracked = lines(runGit(['ls-files', '--others', '--exclude-standard']));
  return [...new Set([...tracked, ...untracked])]; // dedupe, tracked first
}

/** The diff-time arm: for each path, the ADRs whose declared scope prefixes govern it. */
export function scopesView(adrs: Adr[], paths: string[]): ScopeHit[] {
  const sorted = [...adrs].sort(byIdAsc);
  return paths.map((path) => ({
    path,
    adrs: sorted.filter((a) => a.scopes.some((s) => segPrefix(s, path))),
  }));
}
