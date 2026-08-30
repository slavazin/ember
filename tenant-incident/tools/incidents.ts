// incidents — validator for the incident tenant's self-describing case ledger.
//
//   incidents check
//
// The store is tenant-incident/corpus/incidents/INC-nnnn.md. It is self-describing (ships its
// own SCHEMA.md), so the layer entry checks in tools/corpus-lint.ts deliberately leave its shape
// alone (decision 4 / BS-0012); this validator owns the shape, exactly as `adr check` owns the
// build ADR store's. corpus-lint adds only frozen-path byte-immutability and LANGUAGE prose over
// this store. The store reads live; there is no generated index to keep current.
//
// Parse/validate are pure (string in, problems out) so the CLI and the tests share one
// implementation. Frontmatter is parsed through js-yaml under FAILSAFE_SCHEMA — every scalar stays
// a string, so a spec'd format is not hand-rolled (the parse-fidelity discipline of
// tools/INDEX-CONTRACT.md, applied here). The contract is tenant-incident/corpus/incidents/SCHEMA.md.

import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, FAILSAFE_SCHEMA } from 'js-yaml';

export const STATUSES = ['closed', 'superseded', 'moot'] as const;
export type Status = (typeof STATUSES)[number];
export const FORECAST_OUTCOMES = ['hit', 'miss', 'unevaluable'] as const;
export const DISPOSITIONS = ['applied', 'considered-not-applicable'] as const;

// Every frontmatter key the SCHEMA declares. A key outside this set is a typo (a dropped
// `superseded-by:` reads as no successor), so an unknown key fails rather than passing silently.
export const KNOWN_KEYS = [
  'id',
  'status',
  'class',
  'surface',
  'forecast-outcome',
  'disposition',
  'superseded-by',
  'related',
  'occurred',
  'closed',
] as const;

// The narrative sections every case carries (SCHEMA § Sections).
export const REQUIRED_SECTIONS = ['Incident', 'Forecast', 'Root cause', 'Learning', 'Evidence'] as const;

export interface Incident {
  id: string;
  status: string;
  class: string;
  surface: string;
  forecastOutcome: string;
  disposition: string;
  supersededBy?: string;
  related: string[];
  occurred: string;
  closed: string;
  summary: string; // the `# ` title line, without the marker
  file: string; // basename, e.g. INC-0007.md
}

export interface Problem {
  file: string;
  message: string;
}

const ID_RE = /^INC-\d{4}$/;
const ENTRY_FILE_RE = /^INC-\d{4}\.md$/; // exact four digits — never widen to \d+ (loose-acceptance)
const INC_REF_RE = /^INC-\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Exact admitted-entry filename test — one shape, fixed by the SCHEMA. */
export function isEntryFile(name: string): boolean {
  return ENTRY_FILE_RE.test(name);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

function asList(value: unknown): { list: string[]; ok: boolean } {
  if (value === undefined || value === null) return { list: [], ok: true };
  if (!Array.isArray(value)) return { list: [], ok: false };
  return { list: value.map(asString), ok: true };
}

function hasSection(body: string, name: string): boolean {
  return new RegExp(`^##\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(body);
}

function title(body: string): string {
  const m = /^#\s+(.+?)\s*$/m.exec(body);
  return m && m[1] ? m[1].trim() : '';
}

// One entry file's text -> its record plus any per-file shape errors (frontmatter that will not
// parse, an unknown key, a non-scalar where a scalar belongs). The cross-entry checks live in
// checkCorpus, which needs every record first.
export function parseIncidentFile(file: string, text: string): { incident: Incident; errors: string[] } {
  const errors: string[] = [];
  const m = FRONTMATTER_RE.exec(text);
  let data: Record<string, unknown> = {};
  if (!m || m[1] === undefined) {
    errors.push('no frontmatter block');
  } else {
    let doc: unknown;
    try {
      doc = load(m[1], { schema: FAILSAFE_SCHEMA });
    } catch (cause) {
      errors.push(`invalid YAML frontmatter: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
      data = doc as Record<string, unknown>;
    } else if (doc !== undefined) {
      errors.push('frontmatter is not a mapping');
    }
  }

  for (const key of Object.keys(data)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) errors.push(`unknown frontmatter key: ${key}`);
  }
  const related = asList(data['related']);
  if (!related.ok) errors.push('related must be a list of ids');

  const body = m ? text.slice(m[0].length) : text;
  const incident: Incident = {
    id: asString(data['id']),
    status: asString(data['status']),
    class: asString(data['class']),
    surface: asString(data['surface']),
    forecastOutcome: asString(data['forecast-outcome']),
    disposition: asString(data['disposition']),
    supersededBy: data['superseded-by'] === undefined ? undefined : asString(data['superseded-by']),
    related: related.list,
    occurred: asString(data['occurred']),
    closed: asString(data['closed']),
    summary: title(body),
    file,
  };
  return { incident, errors };
}

// Per-entry shape problems that need no cross-entry context. Presence and shape only — never
// whether a root cause is true or an anchor supports its claim (that stays human review).
function checkOne(inc: Incident): string[] {
  const problems: string[] = [];

  if (inc.id === '') problems.push('missing frontmatter id');
  else if (!ID_RE.test(inc.id)) problems.push(`id ${inc.id} is not a canonical INC-nnnn identifier`);
  else if (inc.file !== `${inc.id}.md`) problems.push(`filename must equal ${inc.id}.md`);

  if (inc.status === '') problems.push('missing frontmatter status');
  else if (!(STATUSES as readonly string[]).includes(inc.status)) problems.push(`status ${inc.status} — must be one of: ${STATUSES.join(' | ')}`);

  if (inc.class === '') problems.push('missing frontmatter class');
  if (inc.surface === '') problems.push('missing frontmatter surface');

  if (inc.forecastOutcome === '') problems.push('missing frontmatter forecast-outcome');
  else if (!(FORECAST_OUTCOMES as readonly string[]).includes(inc.forecastOutcome)) problems.push(`forecast-outcome ${inc.forecastOutcome} — must be one of: ${FORECAST_OUTCOMES.join(' | ')}`);

  if (inc.disposition === '') problems.push('missing frontmatter disposition');
  else if (!(DISPOSITIONS as readonly string[]).includes(inc.disposition)) problems.push(`disposition ${inc.disposition} — must be one of: ${DISPOSITIONS.join(' | ')}`);

  if (!DATE_RE.test(inc.occurred)) problems.push("occurred must be an ISO date (YYYY-MM-DD)");
  if (!DATE_RE.test(inc.closed)) problems.push("closed must be an ISO date (YYYY-MM-DD)");

  if (inc.summary === '') problems.push("missing '# ' summary line");

  // Lifecycle: superseded ⟺ a successor pointer; a moot or closed case carries none.
  if (inc.status === 'superseded') {
    if (inc.supersededBy === undefined || inc.supersededBy === '') problems.push('status superseded requires superseded-by');
    else if (!INC_REF_RE.test(inc.supersededBy)) problems.push(`superseded-by ${inc.supersededBy} is not a canonical INC-nnnn identifier`);
  } else if (inc.supersededBy !== undefined && inc.supersededBy !== '') {
    problems.push(`superseded-by set but status is ${inc.status || '(none)'}`);
  }

  for (const rid of inc.related) {
    if (rid === inc.id) problems.push('related lists the entry itself');
  }
  return problems;
}

export interface LoadResult {
  incidents: Array<{ incident: Incident; body: string }>;
  problems: Problem[];
}

// Read the store directory: every INC-nnnn.md becomes a record; a stray .md that is neither a
// standing file nor a canonical entry is a mis-named entry, reported rather than silently ignored.
// A missing store dir is not an error — the ledger is genesis-empty until the loop deposits.
export function loadCorpus(dir: string): LoadResult {
  const incidents: Array<{ incident: Incident; body: string }> = [];
  const problems: Problem[] = [];
  if (!existsSync(dir)) return { incidents, problems };
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'README.md' || name === 'SCHEMA.md') continue;
    if (!isEntryFile(name)) {
      problems.push({ file: name, message: 'not a canonical INC-nnnn.md filename' });
      continue;
    }
    const text = readFileSync(join(dir, name), 'utf8');
    const { incident, errors } = parseIncidentFile(name, text);
    for (const e of errors) problems.push({ file: name, message: e });
    const m = FRONTMATTER_RE.exec(text);
    incidents.push({ incident, body: m ? text.slice(m[0].length) : text });
  }
  return { incidents, problems };
}

// Full validation over the loaded store: per-entry shape, required sections, and the one
// cross-entry check (a same-store superseded-by resolves). related may cite other stores'
// ids (a nominated rule/belief/decision), so a non-INC ref is left for that store to resolve.
export function checkCorpus(loaded: LoadResult): Problem[] {
  const problems: Problem[] = [...loaded.problems];
  const byId = new Map<string, Incident>();
  for (const { incident } of loaded.incidents) if (incident.id !== '') byId.set(incident.id, incident);

  for (const { incident, body } of loaded.incidents) {
    for (const message of checkOne(incident)) problems.push({ file: incident.file, message });
    for (const section of REQUIRED_SECTIONS) {
      if (!hasSection(body, section)) problems.push({ file: incident.file, message: `missing required section: ## ${section}` });
    }
    if (incident.supersededBy !== undefined && INC_REF_RE.test(incident.supersededBy) && !byId.has(incident.supersededBy)) {
      problems.push({ file: incident.file, message: `superseded-by ${incident.supersededBy} resolves to no entry` });
    }
    for (const rid of incident.related) {
      // Only same-store references are resolved here; cross-store ids (R-/B-/D-) are that store's.
      if (INC_REF_RE.test(rid) && !byId.has(rid)) {
        problems.push({ file: incident.file, message: `related ${rid} resolves to no entry` });
      }
    }
  }
  return problems;
}

// ── CLI ──

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_DIR = join(ROOT, 'tenant-incident', 'corpus', 'incidents');

function cmdCheck(): number {
  const loaded = loadCorpus(STORE_DIR);
  const problems = checkCorpus(loaded);
  for (const p of [...problems].sort((a, b) => (a.file + a.message).localeCompare(b.file + b.message))) {
    process.stdout.write(`FAIL  ${p.file}  ${p.message}\n`);
  }
  process.stdout.write(`incidents check: ${loaded.incidents.length} entries, ${problems.length} problem(s)\n`);
  return problems.length > 0 ? 1 : 0;
}

function main(): number {
  const cmd = process.argv[2];
  if (cmd === undefined || cmd === 'check') return cmdCheck();
  process.stderr.write(`incidents: unknown command "${cmd}" — use check\n`);
  return 2;
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

if (isMainModule()) process.exit(main());
