// corpus-lint — the corpus write-seam. It enforces the entry contract
// mechanically: PRESENCE and SHAPE, never quality or truth. That floor is
// deliberate and disclosed (Constitution Art. 8, ISOMORPHISM-PLAN §15); the
// residue block at the end of every run states what each rule does not check.
//
// The index-current rule imports tools/index-contract.ts and never reimplements
// its parse/render/marker logic — reimplementation is the drift that contract
// exists to prevent. The frontmatter reader below is a separate concern: it
// preserves the array and map fields (recurrences, warrant, reference) that the
// index projection deliberately drops, so it is not a duplicate of that module.
//
// Governed by /corpus/LANGUAGE.md — this file's own prose obeys it too.

import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { load, FAILSAFE_SCHEMA } from 'js-yaml';

import {
  INDEX_STORES,
  INDEX_TARGETS,
  markers,
  parseEntry,
  isBlockCurrent,
  isEntryFile,
  STORE_PREFIX,
  type IndexRecord,
  type StoreId,
} from './index-contract.ts';
import { layerEntryFiles, admittedById, isDir } from './store-discovery.ts';

// ── Named constants (the ones a reviewer or a later session will want to change) ──

// The constitution SKILL caps at 10 articles (ISOMORPHISM-PLAN §3, SESSION-NOTES).
// FLAG: planning/constitution.md's header says "hard cap of 12 articles" — that is
// the separate *build* register (gitignored, out of scope for corpus-lint), not the
// shipped skill this check targets. One constant, so the cap is trivial to change if
// Slava rules otherwise.
export const CONSTITUTION_ARTICLE_CAP = 10;
export const CONSTITUTION_SKILL = 'skills/constitution/SKILL.md';

// Stores with one file per entry (five-slot presence applies here). latches/ and
// vocabulary/ are whole-file registers with their own block shapes — not entry stores.
export const ENTRY_STORES = ['decisions', 'rules', 'beliefs'] as const;

// Ledger stores: entries frozen at admission (Art. 9). Registers (rules/, latches/,
// vocabulary/) are corrected in place — exempt from the frozen-path check.
export const FROZEN_STORES = ['decisions', 'beliefs'] as const;

// Admitted-entry selection (`^<PREFIX>-\d{4}\.md$`) and the per-store prefix live in the
// shared contract as isEntryFile / STORE_PREFIX, imported above: the producer (index-gen)
// and this verifier resolve one identical set, never two hand-kept literals that could
// drift (INDEX-CONTRACT.md).

// The in-place frontmatter changes each frozen store permits after admission live with that
// store's contract in frozenStores(); every other frontmatter line and the whole body are
// byte-frozen. Keeping the mutable-key set beside its store (not in one shared table) is what
// stops one store's lifecycle from being asserted over another (decision 4 / BS-0012).

// Frozen-path base: the merged permanent state the working tree is compared against.
// Tried in order; the first that resolves is used via its merge-base with HEAD.
const DEFAULT_BASE_REFS = ['origin/main', 'main'];

// ── Result types ──

export type Severity = 'error' | 'warn';

export interface Finding {
  rule: string;
  file: string; // repo-relative
  line?: number; // 1-indexed when a specific line anchors the finding
  message: string;
  severity: Severity;
}

export interface Skip {
  rule: string;
  reason: string;
}

export interface RuleResult {
  findings: Finding[];
  skips: Skip[];
}

export interface Ctx {
  root: string;
  baseRef?: string; // overrides DEFAULT_BASE_REFS for the frozen check
}

interface Rule {
  name: string;
  run(ctx: Ctx): RuleResult;
  residue: string[]; // what this rule does NOT check — printed every run
}

// ── Small filesystem / text helpers ──

function ok(findings: Finding[] = [], skips: Skip[] = []): RuleResult {
  return { findings, skips };
}

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

// The five stores: corpus subdirectories carrying both a README and a SCHEMA.
function storesWithSchema(root: string): string[] {
  const corpus = join(root, 'corpus');
  if (!isDir(corpus)) return [];
  return readdirSync(corpus)
    .filter((name) => {
      const dir = join(corpus, name);
      return isDir(dir) && existsSync(join(dir, 'README.md')) && existsSync(join(dir, 'SCHEMA.md'));
    })
    .sort();
}

// Every markdown file governed by LANGUAGE.md: the layer prose (corpus scaffold, skill packs,
// role templates), the build ADR store (tenant-build's ADRs are authored under LANGUAGE.md too),
// and the incident tenant's prose. The tenant prose is *.md ONLY and excludes any `fixtures/`
// tree: incident-report and log fixtures carry wall-clock timestamps and image tags that a
// tell/date grep would false-positive on (decision 6 — LANGUAGE governance over tenant prose,
// scoped to prose, not fixtures/scripts/conf).
function languageGovernedFiles(root: string): string[] {
  const out: string[] = [];
  walkMarkdown(join(root, 'corpus'), root, out);
  walkMarkdown(join(root, 'skills'), root, out);
  walkMarkdown(join(root, 'roles'), root, out);
  walkMarkdown(join(root, 'tenant-build', 'corpus'), root, out);
  walkMarkdown(join(root, 'tenant-incident'), root, out, SKIP_PROSE_DIRS);
  return [...new Set(out)].sort();
}

// Subdirectory names whose markdown is not governed prose — skipped by the tenant-prose walk.
const SKIP_PROSE_DIRS = new Set(['fixtures']);

function walkMarkdown(dir: string, root: string, out: string[], skipDirs?: Set<string>): void {
  if (!isDir(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (isDir(abs)) {
      if (skipDirs?.has(name)) continue;
      walkMarkdown(abs, root, out, skipDirs);
    } else if (name.endsWith('.md')) {
      out.push(rel(root, abs));
    }
  }
}

// Repo-relative, always '/'-separated. join() yields '\' on Windows while git's toplevel is
// '/'-form, so normalize BOTH sides before stripping the root — a '/'-only compare left the
// root in place on Windows and produced a doubled path. Downstream checks compare against
// '/'-form literals (INDEX_TARGETS, 'corpus/LANGUAGE.md', refs-resolve targets), so the
// result must be '/'-separated too. (platform-assumption — surfaced by the Windows CI leg.)
export function rel(root: string, abs: string): string {
  const toPosix = (p: string) => p.split('\\').join('/');
  const r = toPosix(root).replace(/\/+$/, '');
  const a = toPosix(abs);
  return a.startsWith(r + '/') ? a.slice(r.length + 1) : a;
}

// Blank out fenced and inline code spans so field names and YAML examples inside code
// are not scanned as prose. Spans are replaced with equal-length blanks to keep line
// and column offsets stable for accurate line reporting.
function stripCodeSpans(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, blankOut)
    .replace(/`[^`\n]*`/g, blankOut);
}

function blankOut(span: string): string {
  return span.replace(/[^\n]/g, ' ');
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function hasSection(body: string, name: string): boolean {
  return new RegExp(`^##\\s+${name}\\s*$`, 'm').test(body);
}

function hasTitle(body: string): boolean {
  return /^#\s+\S/m.test(body);
}

interface Frontmatter {
  present: boolean;
  data: Record<string, unknown>;
  raw: string; // the text between the fences, exclusive
  body: string; // everything after the closing fence
}

// Read the YAML frontmatter with a string-only schema (no date/number coercion), and
// split off the body. Unlike index-contract's index parse, this preserves array and
// map fields — five-slot presence needs recurrences/warrant lengths and reference maps.
function readFrontmatter(text: string): Frontmatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m || m[1] === undefined) {
    return { present: false, data: {}, raw: '', body: text };
  }
  const raw = m[1];
  const body = text.slice(m[0].length);
  let doc: unknown;
  try {
    doc = load(raw, { schema: FAILSAFE_SCHEMA });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`invalid YAML frontmatter: ${detail}`);
  }
  const data = doc !== null && typeof doc === 'object' ? (doc as Record<string, unknown>) : {};
  return { present: true, data, raw, body };
}

function scalarPresent(data: Record<string, unknown>, key: string): boolean {
  const v = data[key];
  return typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' || typeof v === 'boolean';
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
}

// ── git helpers (frozen-path check) ──

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function gitAvailable(root: string): boolean {
  try {
    git(root, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

// The merge-base of HEAD and the first base ref that resolves. Comparing against the
// fork point (not the base tip) keeps an advancing base from flagging untouched entries.
function resolveFrozenBase(root: string, override?: string): string | undefined {
  const candidates = override ? [override] : DEFAULT_BASE_REFS;
  for (const ref of candidates) {
    try {
      git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    } catch {
      continue;
    }
    try {
      return git(root, ['merge-base', 'HEAD', ref]).trim();
    } catch {
      return git(root, ['rev-parse', ref]).trim();
    }
  }
  return undefined;
}

function headSha(root: string): string | undefined {
  try {
    return git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    return undefined;
  }
}

// True when the working tree (staged and unstaged) is byte-identical to HEAD for the given
// paths — i.e. `git diff` reports no change, so a base pinned at HEAD would see nothing there.
function workingTreeMatchesHead(root: string, paths: string[]): boolean {
  try {
    git(root, ['diff', '--quiet', 'HEAD', '--', ...paths]);
    return true; // exit 0 — no diff
  } catch {
    return false; // non-zero exit — a diff exists (or git errored); let the check run
  }
}

function gitShow(root: string, commit: string, path: string): string | undefined {
  try {
    return execFileSync('git', ['-C', root, 'show', `${commit}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

function lsTreeFiles(root: string, commit: string, paths: string[]): string[] {
  try {
    const out = git(root, ['ls-tree', '-r', '--name-only', commit, '--', ...paths]);
    return out.split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

// ═══════════════════════════ Rules ═══════════════════════════

// R1 — index-current. Assert each store's generated index region is present and matches
// a fresh render of its admitted entries, reusing index-contract's checker.
function indexCurrent(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  const skips: Skip[] = [];
  const skillsExist = isDir(join(ctx.root, 'skills'));

  for (const store of INDEX_STORES) {
    const target = INDEX_TARGETS[store];
    if (!existsSync(join(ctx.root, target))) {
      // Bootstrap tolerance: while skills/ does not exist (Track C not landed), an
      // absent host is a disclosed skip. Once skills/ exists, an absent target is a
      // failure — the host shell should have reserved its region.
      if (skillsExist) {
        findings.push({ rule: 'index-current', file: target, severity: 'error', message: `index host missing for store '${store}'` });
      } else {
        skips.push({ rule: 'index-current', reason: `${target} absent (skills/ not created yet — Track C)` });
      }
      continue;
    }

    const admitted = layerEntryFiles(ctx.root, store).filter((p) => isEntryFile(store as StoreId, basename(p)));
    const records: IndexRecord[] = [];
    let parseFailed = false;
    for (const relPath of admitted) {
      try {
        records.push(parseEntry(store as StoreId, read(ctx.root, relPath)));
      } catch (cause) {
        parseFailed = true;
        findings.push({ rule: 'index-current', file: relPath, severity: 'error', message: `admitted entry does not parse: ${msg(cause)}` });
      }
    }
    if (parseFailed) continue; // can't reliably compare a partial record set

    try {
      if (!isBlockCurrent(read(ctx.root, target), store as StoreId, records)) {
        findings.push({ rule: 'index-current', file: target, severity: 'error', message: `index region for '${store}' is stale — run index-gen` });
      }
    } catch (cause) {
      findings.push({ rule: 'index-current', file: target, severity: 'error', message: `index markers for '${store}' missing or malformed: ${msg(cause)}` });
    }
  }
  return ok(findings, skips);
}

// R2 — five-slot presence. Structural slots on every entry; the admission-bar counts
// (recurrences ≥2, warrant ≥2 decision IDs) only on admitted entries, since Art. 4
// permits incomplete drafts on a branch and the bar is a human gate at merge.
function fiveSlot(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const store of ENTRY_STORES) {
    for (const relPath of layerEntryFiles(ctx.root, store)) {
      const file = basename(relPath);
      let fm: Frontmatter;
      try {
        fm = readFrontmatter(read(ctx.root, relPath));
      } catch (cause) {
        findings.push({ rule: 'five-slot', file: relPath, severity: 'error', message: msg(cause) });
        continue;
      }
      const admitted = scalarPresent(fm.data, 'id');
      const fail = (m: string) => findings.push({ rule: 'five-slot', file: relPath, severity: 'error', message: m });

      if (!fm.present) fail('no frontmatter block');
      if (!hasTitle(fm.body)) fail("missing '# ' summary line");

      // Identity: an id-bearing entry must be named exactly `<id>.md` with a canonical id.
      // The index keys on the id and frozen-path keys on the filename; if the two disagree
      // (D-0008.md carrying id D-0007) they resolve to different entries.
      if (admitted) {
        const id = asString(fm.data['id']);
        const prefix = STORE_PREFIX[store as StoreId];
        if (!isEntryFile(store as StoreId, `${id}.md`)) fail(`id '${id}' is not a canonical ${prefix}-nnnn identifier`);
        else if (file !== `${id}.md`) fail(`filename must be '${id}.md' to match its id — found '${file}'`);
      }

      // status: present and one of the store's lifecycle values — a frozen entry may only
      // flip status among these, so a nonsense value must not pass here.
      requireEnum(fail, fm.data, 'status', STATUS_VALUES[store] ?? []);

      if (store === 'decisions') {
        for (const s of ['Decision', 'Warrant', 'Revisit']) if (!hasSection(fm.body, s)) fail(`missing section '## ${s}'`);
        if (admitted) {
          if (!scalarPresent(fm.data, 'created')) fail("missing frontmatter 'created' (YYYY-MM-DD of admission)");
          if (!recurrencesOk(fm.data['recurrences'])) fail('recurrences must list ≥2 `<surface>: <anchor>` occurrences');
        }
      } else if (store === 'rules') {
        if (!scalarPresent(fm.data, 'fires-when')) fail("missing frontmatter 'fires-when'");
        if (!('not-this' in fm.data)) fail("missing frontmatter 'not-this' (may be empty on a young rule, but the key is required)");
        if (!scalarPresent(fm.data, 'floor')) fail("missing frontmatter 'floor'");
        if (!scalarPresent(fm.data, 'residue')) fail("missing frontmatter 'residue'");
        if (!hasSection(fm.body, 'Duty')) fail("missing section '## Duty'");
        if (admitted && !warrantOk(fm.data['warrant'])) fail('warrant must cite ≥2 decision IDs (D-nnnn) from distinct surfaces');
      } else {
        // beliefs
        for (const s of ['Claim', 'Falsifier']) if (!hasSection(fm.body, s)) fail(`missing section '## ${s}'`);
        if (!scalarPresent(fm.data, 'consult-when')) fail("missing frontmatter 'consult-when'");
        if (!scalarPresent(fm.data, 'deadline')) fail("missing frontmatter 'deadline'");
        requireEnum(fail, fm.data, 'postdiction', ['true', 'false']);
        if (!referenceOk(fm.data['reference'])) fail("frontmatter 'reference' needs a non-empty class plus a price or categorical");
        if (admitted && !scalarPresent(fm.data, 'created')) fail("missing frontmatter 'created' (YYYY-MM-DD of admission)");
        if (!admitted && scalarPresent(fm.data, 'verdict')) fail('a draft (no minted id) must carry an empty verdict');
      }
    }
  }
  return ok(findings);
}

// Lifecycle status vocabularies per store (decisions/rules/beliefs SCHEMAs).
const STATUS_VALUES: Record<string, readonly string[]> = {
  decisions: ['active', 'superseded', 'moot'],
  rules: ['active', 'demoted'],
  beliefs: ['live', 'settled', 'superseded'],
};

function requireEnum(fail: (m: string) => void, data: Record<string, unknown>, key: string, allowed: readonly string[]): void {
  const v = asString(data[key]);
  if (v === '') fail(`missing frontmatter '${key}'`);
  else if (!allowed.includes(v)) fail(`'${key}' is '${v}' — must be one of: ${allowed.join(' | ')}`);
}

function warrantOk(value: unknown): boolean {
  return Array.isArray(value) && value.length >= 2 && value.every((v) => /^D-\d+$/.test(asString(v)));
}

// Each recurrence is a non-empty `<surface>: <anchor>` map with a non-empty anchor —
// counted and shape-checked only; whether the anchor resolves is review judgment.
function recurrencesOk(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  return value.every((item) => {
    if (!isPlainObject(item)) return false;
    const entries = Object.entries(item as Record<string, unknown>);
    // Exactly one `<surface>: <anchor>` mapping, both halves non-empty.
    return entries.length === 1 && entries.every(([k, v]) => k.trim() !== '' && asString(v) !== '');
  });
}

// A reference needs a non-empty class plus one departure form — a `{value, source, as-of}`
// price map (scalar fields) or a scalar categorical state (beliefs/SCHEMA §reference).
// Presence and shape only; the number's truth is never judged.
function referenceOk(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const ref = value as Record<string, unknown>;
  if (asString(ref['class']) === '') return false;
  return priceMapOk(ref['price']) || scalarNonEmpty(ref['categorical']);
}

function isPlainObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function scalarNonEmpty(v: unknown): boolean {
  return v != null && typeof v !== 'object' && asString(v) !== '';
}

function priceMapOk(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const p = v as Record<string, unknown>;
  return ['value', 'source', 'as-of'].every((k) => scalarNonEmpty(p[k]));
}

// R2b — tombstone on retire. A retired ledger entry carries its successor pointer, and a
// successor pointer implies retirement (Art. 9, ISO §5 "every retirement tombstones").
function tombstone(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const store of FROZEN_STORES) {
    for (const relPath of layerEntryFiles(ctx.root, store)) {
      let fm: Frontmatter;
      try {
        fm = readFrontmatter(read(ctx.root, relPath));
      } catch {
        continue; // five-slot already reports the parse failure
      }
      const status = asString(fm.data['status']);
      const successor = asString(fm.data['superseded-by']);
      if (status === 'superseded' && successor === '') {
        findings.push({ rule: 'tombstone', file: relPath, severity: 'error', message: "status 'superseded' requires a 'superseded-by' successor pointer" });
      }
      if (successor !== '' && status !== 'superseded') {
        findings.push({ rule: 'tombstone', file: relPath, severity: 'error', message: `'superseded-by' is set but status is '${status || '(none)'}', not 'superseded'` });
      }
    }
  }
  return ok(findings);
}

// R3 — constitution cap. The constitution SKILL holds no more than CONSTITUTION_ARTICLE_CAP
// articles; forced eviction is the discipline, the count is what lint enforces.
function constitutionCap(ctx: Ctx): RuleResult {
  if (!existsSync(join(ctx.root, CONSTITUTION_SKILL))) {
    return ok([], [{ rule: 'constitution-cap', reason: `${CONSTITUTION_SKILL} absent (Track C not landed)` }]);
  }
  const text = read(ctx.root, CONSTITUTION_SKILL);
  // An article/rule lead at line start carries a REQUIRED marker — a heading, list
  // bullet, or bold run. The marker is what distinguishes an article heading from bare
  // prose ("Article 11 is discussed below"), and distinct numbers are counted so a
  // cross-reference ("see Article 3") never adds. Track C authors `## Article N — `.
  const re = /^[ \t]*(?:#{1,6}[ \t]*|[-*][ \t]+|\*\*)(?:Article|Rule)\s+(\d+)\b/gim;
  const numbers = new Set<string>();
  for (const m of text.matchAll(re)) if (m[1] !== undefined) numbers.add(m[1]);
  if (numbers.size > CONSTITUTION_ARTICLE_CAP) {
    return ok([
      {
        rule: 'constitution-cap',
        file: CONSTITUTION_SKILL,
        severity: 'error',
        message: `${numbers.size} articles exceeds the cap of ${CONSTITUTION_ARTICLE_CAP} — evict before adding`,
      },
    ]);
  }
  return ok();
}

// The immutability contract for a base-commit path, resolved by CONVENTION — never by reading
// the working tree alone — so an entry whose store directory is DELETED in this change is still
// classified and its removal caught (a working-tree-derived scope would let a deletion shrink the
// gate's own coverage). Returns the frontmatter keys that may flip after admission, or undefined
// when the path is not a layer-contract frozen ledger entry. Each store keys off its OWN contract
// — the incident case bar is never forced onto the build ADR store and the reverse (decision 4 /
// BS-0012): the build ADR flips status/superseded-by/converged-into, the incident belief a human
// verdict. `selfDescribing` is the set of tenant store dirs shipping their OWN SCHEMA (in the base
// or the working tree): those are owned by their own validator, so the generic layer contract must
// NOT be applied to them — keeping this gate's ownership consistent with discovery's exclusion.
function frozenContractForPath(path: string, selfDescribing: ReadonlySet<string>): readonly string[] | undefined {
  const name = basename(path);
  // tenant-build's ADR store, bound to its exact tree (BS-0019): ADR-nnnn (exact four digits,
  // never widened — loose-acceptance). This byte-immutability gate is what `adr check` (shape
  // only) does not itself run.
  if (path.startsWith('tenant-build/corpus/decisions/') && /^ADR-\d{4}\.md$/.test(name)) {
    return ['status', 'superseded-by', 'converged-into'];
  }
  // Layer ledgers (decisions, beliefs) under any corpus root — the root scaffold or a tenant
  // instance that INHERITS the layer D-/B- contract (a tenant store with its own SCHEMA is
  // self-describing and owned by its own validator, so it is excluded here).
  const m = /^((?:corpus|tenant-[^/]+\/corpus)\/(decisions|beliefs))\/[^/]+$/.exec(path);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    if (selfDescribing.has(m[1])) return undefined;
    const store = m[2] as StoreId;
    if (!isEntryFile(store, name)) return undefined;
    return store === 'beliefs' ? ['status', 'superseded-by', 'verdict'] : ['status', 'superseded-by'];
  }
  return undefined;
}

// The tenant store dirs that ship their OWN SCHEMA.md — in the working tree OR the base commit,
// so a store deleted by this change is still recognized as self-describing. The root scaffold is
// the layer definition, never self-describing. `dirs` is the frozen pathspec (store directories).
function selfDescribingStoreDirs(root: string, base: string, dirs: string[]): Set<string> {
  const out = new Set<string>();
  for (const dir of dirs) {
    if (dir.startsWith('corpus/')) continue; // the root scaffold defines the layer contract
    const schema = `${dir}/SCHEMA.md`;
    if (existsSync(join(root, schema)) || gitShow(root, base, schema) !== undefined) out.add(dir);
  }
  return out;
}

// The git pathspec for the frozen check, STABLE across this change: corpus (the layer) always,
// plus every tenant corpus tree present in the working tree OR the base commit. Deriving it from
// the base too (not the working tree alone) is what keeps a deletion from removing its own store
// from scrutiny — classification by convention then filters each returned path to frozen entries.
function frozenPathspec(root: string, base: string): string[] {
  const roots = new Set<string>(['corpus']);
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    /* not readable — the corpus scaffold below still covers the layer */
  }
  for (const name of names) if (name.startsWith('tenant-') && isDir(join(root, name, 'corpus'))) roots.add(`${name}/corpus`);
  for (const name of gitTopLevelNames(root, base)) if (name.startsWith('tenant-')) roots.add(`${name}/corpus`);
  const dirs: string[] = [];
  for (const r of [...roots].sort()) for (const store of FROZEN_STORES) dirs.push(`${r}/${store}`);
  return dirs;
}

// Top-level names in a commit's tree — used to find tenant trees that exist in the base but were
// deleted from the working tree. Empty on any git error (the caller degrades to working-tree scope).
function gitTopLevelNames(root: string, commit: string): string[] {
  try {
    return git(root, ['ls-tree', '--name-only', commit]).split('\n').filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

// R4 — frozen-path immutability. A ledger entry admitted before this branch is byte-frozen
// except for the sanctioned lifecycle fields; deletion or rename of one is a violation.
function frozenPath(ctx: Ctx): RuleResult {
  if (!gitAvailable(ctx.root)) {
    return ok([], [{ rule: 'frozen-path', reason: 'not a git work tree — cannot diff against a base' }]);
  }
  const base = resolveFrozenBase(ctx.root, ctx.baseRef);
  if (base === undefined) {
    return ok([], [
      {
        rule: 'frozen-path',
        reason:
          'no base ref resolves (tried ' +
          (ctx.baseRef ? ctx.baseRef : DEFAULT_BASE_REFS.join(', ')) +
          ') — frozen entries are UNCHECKED. In CI, fetch the base (fetch-depth: 0) or pass --base <ref>.',
      },
    ]);
  }
  const findings: Finding[] = [];
  const paths = frozenPathspec(ctx.root, base);

  // BS-0023 (self-referential-baseline): frozenPath compares the base commit against the
  // WORKING TREE. When the base resolves to HEAD, that catches uncommitted edits (the normal
  // local pre-commit flow) but is blind to a mutation already committed into HEAD — the exact
  // exposure on a push to main, where origin/main sits at HEAD and the checkout is clean. So
  // the self-compare is vacuous only when base == HEAD AND the working tree matches HEAD for
  // the frozen paths: there is genuinely nothing this run can see. Disclose a skip rather than
  // report a clean pass; the caller must pin the base to the state BEFORE the change (CI: the
  // PR base SHA, or github.event.before).
  const head = headSha(ctx.root);
  if (head !== undefined && head === base && workingTreeMatchesHead(ctx.root, paths)) {
    return ok([], [
      {
        rule: 'frozen-path',
        reason:
          'the resolved base equals HEAD with a clean working tree (the base ref points at the ' +
          'commit under test — e.g. a push to main with origin/main at HEAD) — frozen entries are ' +
          'UNCHECKED rather than compared to themselves. Pass --base <before-SHA> (CI: the PR base ' +
          'SHA / github.event.before).',
      },
    ]);
  }
  const selfDescribing = selfDescribingStoreDirs(ctx.root, base, paths);
  for (const path of lsTreeFiles(ctx.root, base, paths)) {
    const mutableKeys = frozenContractForPath(path, selfDescribing);
    if (mutableKeys === undefined) continue; // not a layer-contract frozen ledger entry
    const baseText = gitShow(ctx.root, base, path);
    if (baseText === undefined) continue;
    // Compare the type WITHOUT following symlinks: a frozen entry is a tracked regular file, so a
    // gone path is a deletion and a path replaced by a symlink or directory is a type change — both
    // violations. lstat (not existsSync, which follows links) also keeps read() below off a symlink
    // target or a directory, where readFileSync would silently follow or throw EISDIR and abort lint.
    let stat;
    try {
      stat = lstatSync(join(ctx.root, path));
    } catch {
      findings.push({ rule: 'frozen-path', file: path, severity: 'error', message: 'frozen ledger entry deleted or renamed — supersede in place, never remove' });
      continue;
    }
    if (!stat.isFile()) {
      findings.push({ rule: 'frozen-path', file: path, severity: 'error', message: 'frozen ledger entry replaced by a symlink or directory — supersede the file in place, never replace it' });
      continue;
    }
    const diff = frozenDelta(mutableKeys, baseText, read(ctx.root, path));
    if (diff) findings.push({ rule: 'frozen-path', file: path, severity: 'error', message: diff });
  }
  return ok(findings);
}

// Returns a message if the head text changed a frozen part of the entry, else null. The
// body is byte-frozen; frontmatter lines other than the store's mutable keys are frozen.
function frozenDelta(mutable: readonly string[], baseText: string, headText: string): string | null {
  const base = readFrontmatter(baseText);
  const head = readFrontmatter(headText);
  if (base.body !== head.body) return 'the frozen body was edited — supersede the entry instead';
  if (stripMutableKeys(base.raw, mutable) !== stripMutableKeys(head.raw, mutable)) {
    return `frozen frontmatter changed — only ${mutable.join(', ')} may change in place`;
  }
  return null;
}

// Drop each mutable top-level key AND its full value from the frontmatter, so what remains is
// the byte-frozen part. A mutable value may span lines (a YAML list like `converged-into` on the
// build ADR store), so the key's continuation lines are dropped with it — a line-only filter
// would freeze the list items and reject a sanctioned convergence. A continuation is an indented
// line, a blank line, OR a block-sequence item at column zero (`- ADR-0009`): js-yaml accepts a
// sequence directly under a mapping key with no extra indentation, so that form must be
// recognized too (parse-fidelity — an indentationless list is still the mutable value).
function stripMutableKeys(fmRaw: string, mutable: readonly string[]): string {
  const kept: string[] = [];
  let inMutableBlock = false;
  for (const line of fmRaw.split('\n')) {
    const topKey = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (topKey && topKey[1] !== undefined) {
      inMutableBlock = mutable.includes(topKey[1]);
      if (!inMutableBlock) kept.push(line);
      continue;
    }
    // continuation of the dropped value: indented, blank, or a column-0 sequence item
    if (inMutableBlock && (/^\s/.test(line) || /^-(\s|$)/.test(line) || line.trim() === '')) continue;
    inMutableBlock = false;
    kept.push(line);
  }
  return kept.join('\n');
}

// R5 — no duty language in a decision body. The duty hook belongs to rules; a decision
// constrains, it does not fire (decisions/SCHEMA, LANGUAGE.md mechanical checks).
function noDutyLanguage(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const relPath of layerEntryFiles(ctx.root, 'decisions')) {
    const text = stripCodeSpans(read(ctx.root, relPath));
    const m = /\bfires-when\b/.exec(text);
    if (m) findings.push({ rule: 'no-duty-language', file: relPath, line: lineAt(text, m.index), severity: 'error', message: "duty language 'fires-when' in a decision body — a decision constrains, a rule fires" });
  }
  return ok(findings);
}

// Banned tells (LANGUAGE.md L1). Phrases and distinctive adverbs are gated as errors;
// common words are advisory warnings, since a rare legitimate use (LANGUAGE.md itself
// writes "New terms enter…") is the author's cue to reword, not a build-breaking defect.
const TELL_ERRORS: Array<[RegExp, string]> = [
  [/\bthis session\b/gi, 'this session'],
  [/\bas discussed\b/gi, 'as discussed'],
  [/\bat the moment\b/gi, 'at the moment'],
  [/\bwas added\b/gi, 'was added'],
  [/\bhas been changed\b/gi, 'has been changed'],
  [/\bwe decided\b/gi, 'we decided'],
  [/\bfor now\b/gi, 'for now'],
  [/\bcurrently\b/gi, 'currently'],
  [/\brecently\b/gi, 'recently'],
  [/\btemporarily\b/gi, 'temporarily'],
  [/\bTODO\b/g, 'TODO'],
];
const TELL_WARNINGS: Array<[RegExp, string]> = [
  [/\bwe\b/gi, 'we'],
  [/\bnow\b/gi, 'now'],
  [/\bnew\b/gi, 'new'],
  [/\bold\b/gi, 'old'],
  [/\blatest\b/gi, 'latest'],
  [/\bupdated\b/gi, 'updated'],
  [/\bimproved\b/gi, 'improved'],
  [/\bI\b(?![/])/g, 'I'], // first-person I, but not I/O
];

// R6 — banned-tell grep over the corpus, skill packs, and role templates. LANGUAGE.md is
// excluded surgically, not skipped: it documents every tell in its L1 table and quoted
// examples, so those are stripped, but its prose is still scanned for hard tells. The
// common-word advisories are the one thing not run against LANGUAGE.md — it is the file
// that defines those words, so a warning there would be noise, not signal.
function bannedTell(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const relPath of languageGovernedFiles(ctx.root)) {
    const isLanguage = relPath === 'corpus/LANGUAGE.md';
    let text = stripCodeSpans(read(ctx.root, relPath));
    if (isLanguage) text = stripSelfDoc(text);
    for (const [re, label] of TELL_ERRORS) collect(findings, 'banned-tell', relPath, text, re, `session-bias tell '${label}' — address the reader (LANGUAGE.md L1)`, 'error');
    if (!isLanguage) {
      for (const [re, label] of TELL_WARNINGS) collect(findings, 'banned-tell', relPath, text, re, `possible tell '${label}' — name the referent or use an as-of date (LANGUAGE.md L1)`, 'warn');
    }
  }
  return ok(findings);
}

// Blank LANGUAGE.md's self-documentation — its L1 tables (markdown rows) and its
// double-quoted example strings — while preserving offsets, so what remains to scan is
// its own prose. A tell written into that prose is a real defect and is caught.
function stripSelfDoc(text: string): string {
  const noTables = text
    .split('\n')
    .map((l) => (/^\s*\|/.test(l) ? blankOut(l) : l))
    .join('\n');
  return noTables.replace(/"[^"]*"/g, blankOut);
}

// R7 — date format. Flag non-ISO date shapes; YYYY-MM-DD placeholders and valid ISO dates
// do not match. Presence-not-quality: the date's correctness is not checked.
function dateFormat(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  const patterns: RegExp[] = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, // 08/27/2026
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/g, // Aug 27
  ];
  const unpaddedIso = /\b\d{4}-\d{1,2}-\d{1,2}\b/g;
  const paddedIso = /^\d{4}-\d{2}-\d{2}$/;
  for (const relPath of languageGovernedFiles(ctx.root)) {
    const text = stripCodeSpans(read(ctx.root, relPath));
    for (const re of patterns) collect(findings, 'date-format', relPath, text, re, 'non-ISO date — use YYYY-MM-DD (LANGUAGE.md reference discipline)', 'error');
    for (const m of text.matchAll(unpaddedIso)) {
      if (!paddedIso.test(m[0])) findings.push({ rule: 'date-format', file: relPath, line: lineAt(text, m.index ?? 0), severity: 'error', message: `malformed ISO date '${m[0]}' — pad to YYYY-MM-DD` });
    }
  }
  return ok(findings);
}

// R8 — Do/Don't pairing. LANGUAGE.md L3 mandates the pair "in SCHEMAs, skill packs, and
// role templates", so all three layer directive surfaces are checked; the ordered markers
// must alternate Do, Don't. The marker requires a colon (**Do:** or **Do: text**), so it
// keys on the pair convention and never mistakes bold emphasis like **Do not** for a Do.
// LANGUAGE.md itself is out of scope — it is the rule's source and discusses the pattern.
function doDontPairing(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  const doRe = /\*\*Do\b[^*]*:[^*]*\*\*/g;
  const dontRe = /\*\*Don['’]t\b[^*]*:[^*]*\*\*/g;
  for (const relPath of doDontFiles(ctx.root)) {
    const text = read(ctx.root, relPath);
    const seq: Array<{ kind: 'do' | 'dont'; index: number }> = [];
    for (const m of text.matchAll(doRe)) seq.push({ kind: 'do', index: m.index ?? 0 });
    for (const m of text.matchAll(dontRe)) seq.push({ kind: 'dont', index: m.index ?? 0 });
    seq.sort((a, b) => a.index - b.index);
    let broke = false;
    for (let i = 0; i < seq.length && !broke; i++) {
      const entry = seq[i];
      if (entry === undefined) continue;
      const expected = i % 2 === 0 ? 'do' : 'dont';
      if (entry.kind !== expected) {
        findings.push({ rule: 'do-dont', file: relPath, line: lineAt(text, entry.index), severity: 'error', message: `unpaired Do/Don't — every **Do:** needs a sibling **Don't:** (LANGUAGE.md L3)` });
        broke = true;
      } else if (expected === 'dont') {
        // The Don't must sit in the same block as the Do it pairs with; a blank line
        // between them means that Do's own sibling is missing and a distant Don't is
        // standing in — which L3's per-directive requirement forbids.
        const doMarker = seq[i - 1];
        if (doMarker !== undefined && /\n[ \t]*\n/.test(text.slice(doMarker.index, entry.index))) {
          findings.push({ rule: 'do-dont', file: relPath, line: lineAt(text, doMarker.index), severity: 'error', message: `a **Do:** and its **Don't:** must sit in the same block — a blank line separates them (LANGUAGE.md L3)` });
          broke = true;
        }
      }
    }
    if (!broke && seq.length % 2 !== 0) {
      const last = seq[seq.length - 1];
      findings.push({ rule: 'do-dont', file: relPath, line: last ? lineAt(text, last.index) : undefined, severity: 'error', message: `a Do or Don't is missing its sibling (LANGUAGE.md L3)` });
    }
  }
  return ok(findings);
}

// SCHEMAs plus the layer's other directive surfaces — skill packs and role templates —
// where LANGUAGE.md L3 also mandates Do/Don't pairs. Files without the pattern yield
// nothing, so listing them broadly is safe.
function doDontFiles(root: string): string[] {
  const files: string[] = [];
  for (const store of storesWithSchema(root)) {
    const p = `corpus/${store}/SCHEMA.md`;
    if (existsSync(join(root, p))) files.push(p);
  }
  walkMarkdown(join(root, 'skills'), root, files);
  walkMarkdown(join(root, 'roles'), root, files);
  return files;
}

// R9 — every store README declares register or ledger (LANGUAGE.md; corpus/README.md).
function readmeKind(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const store of storesWithSchema(ctx.root)) {
    const relPath = `corpus/${store}/README.md`;
    const text = read(ctx.root, relPath);
    if (!/^\*\*Kind:\*\*\s+(ledger|register)/im.test(text)) {
      findings.push({ rule: 'readme-kind', file: relPath, severity: 'error', message: "README must declare '**Kind:** ledger' or '**Kind:** register'" });
    }
  }
  return ok(findings);
}

// R10 — escapes valid. A closed-vocabulary escape is `other(<what>)` with non-empty text
// (LANGUAGE.md lexicon, ISO §7.5). Flags other() and unclosed other(.
function escapesValid(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  // The closing paren must belong to this same token, on the same line — `[^)\n]*` keeps
  // the match from spanning lines to an unrelated `)` later in the file.
  const re = /\bother\(([^)\n]*)(\))?/g;
  for (const relPath of languageGovernedFiles(ctx.root)) {
    const text = stripCodeSpans(read(ctx.root, relPath));
    for (const m of text.matchAll(re)) {
      const inner = m[1] ?? '';
      const closed = m[2] === ')';
      if (!closed) {
        findings.push({ rule: 'escapes', file: relPath, line: lineAt(text, m.index ?? 0), severity: 'error', message: 'unclosed escape — write other(<what>)' });
      } else if (inner.trim() === '') {
        findings.push({ rule: 'escapes', file: relPath, line: lineAt(text, m.index ?? 0), severity: 'error', message: 'empty escape other() — name what it stands for: other(<what>)' });
      }
    }
  }
  return ok(findings);
}

// R11 — layer/tenant seam (Art. 7). The reusable layer carries zero tenant knowledge; a
// layer file naming a tenant term is a leak. Tenant vocabulary is DERIVED (Art. 8), not
// hand-listed. The generated index region inside store skills is exempt — it is a
// legitimate derived projection of tenant entries.
//
// tenant-build is exempt from this rule by construction, and deliberately so: its subject IS
// the layer, so its ADRs legitimately name corpus-lint, index-gen, and the seam. tenant→layer
// references are always allowed; only layer→tenant is banned. So tenant-build is neither a
// SOURCE of derived tenant vocabulary (tenantVocabulary reads only the incident tenant) nor a
// scanned LAYER file (layerFiles walks the root layer trees, not tenant-*/). The exemption
// binds to the tenant tree itself, never to a marker a file could wear (BS-0019).
function checkSeam(ctx: Ctx): RuleResult {
  const terms = tenantVocabulary(ctx.root);
  if (terms.length === 0) {
    return ok([], [{ rule: 'check-seam', reason: 'no tenant vocabulary derivable yet (no scenarios, empty terms.md) — seam grep is a no-op until vocabulary grows (Track D)' }]);
  }
  const findings: Finding[] = [];
  const termRe = new RegExp(`\\b(${terms.map(escapeRe).join('|')})\\b`, 'gi');
  for (const relPath of layerFiles(ctx.root)) {
    let text = read(ctx.root, relPath);
    // Only a store's own generated index host exempts that store's region — the derived
    // tenant summaries there are legitimate. A fake marker pair dropped into any other
    // layer file must NOT hide tenant text from the grep.
    for (const store of INDEX_STORES) {
      if (INDEX_TARGETS[store] === relPath) text = stripIndexRegion(text, store as StoreId);
    }
    for (const m of text.matchAll(termRe)) {
      findings.push({ rule: 'check-seam', file: relPath, line: lineAt(text, m.index ?? 0), severity: 'error', message: `tenant term '${m[0]}' in a layer file — the reusable layer must carry no tenant knowledge (Art. 7)` });
    }
  }
  return ok(findings);
}

// Derived tenant terms: scenario base names (variant suffix stripped) and the term
// headers grown in corpus/vocabulary/terms.md.
// FLAG: service names (e.g. checkout-svc) are not derivable from these sources; when
// tenants grow them they must be named into vocabulary/terms.md to become greppable, or
// a tenant-side supplemental list is needed (Track D).
function tenantVocabulary(root: string): string[] {
  const terms = new Set<string>();
  for (const scenarioRoot of ['scenarios', 'tenant-incident/scenarios']) {
    const dir = join(root, scenarioRoot);
    if (isDir(dir)) {
      for (const name of readdirSync(dir)) {
        if (isDir(join(dir, name))) terms.add(name.replace(/-[a-z]$/, ''));
      }
    }
  }
  const termsFile = join(root, 'corpus/vocabulary/terms.md');
  if (existsSync(termsFile)) {
    for (const m of readFileSync(termsFile, 'utf8').matchAll(/^##\s+(.+?)\s*$/gm)) {
      if (m[1] !== undefined) terms.add(m[1].trim());
    }
  }
  return [...terms].filter((t) => t.length > 0);
}

function layerFiles(root: string): string[] {
  const out: string[] = [];
  for (const dir of ['tools', 'skills', 'roles']) walkMarkdownAndCode(join(root, dir), root, out);
  // corpus standing files (READMEs, SCHEMAs, LANGUAGE.md, corpus/README.md) are layer too
  const corpus = join(root, 'corpus');
  if (isDir(corpus)) {
    for (const name of readdirSync(corpus)) {
      const abs = join(corpus, name);
      if (!isDir(abs) && name.endsWith('.md')) out.push(rel(root, abs));
    }
    for (const store of storesWithSchema(root)) {
      for (const standing of ['README.md', 'SCHEMA.md']) {
        const p = `corpus/${store}/${standing}`;
        if (existsSync(join(root, p))) out.push(p);
      }
    }
  }
  return out.sort();
}

function walkMarkdownAndCode(dir: string, root: string, out: string[]): void {
  if (!isDir(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (isDir(abs)) walkMarkdownAndCode(abs, root, out);
    // Test files are dev scaffolding, not the shipped layer: a seam test must carry tenant
    // terms as fixtures, so scanning *.test.ts would flag the suite against itself. Art. 7
    // binds the reusable layer that installs into a tenant, not its test harness — exclude.
    else if (/\.(md|ts)$/.test(name) && !name.endsWith('.test.ts')) out.push(rel(root, abs));
  }
}

// Remove one store's generated index region (between its markers) — used only on that
// store's own index host, so a marker pair elsewhere cannot exempt arbitrary text.
function stripIndexRegion(text: string, store: StoreId): string {
  const { begin, end } = markers(store);
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  if (b !== -1 && e !== -1 && e > b) return text.slice(0, b) + text.slice(e + end.length);
  return text;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// R12 — reference resolution (BS-0010, dangling-reference). A skill, SCHEMA, or protocol
// that names a companion file the reader must open must ship that file — an unresolvable path
// halts the walk at read time (the session boot walk that opened absent latch tables was the
// original miss). Over LANGUAGE-governed prose AND the tool protocols (tools/*.md) it checks
// two reference shapes resolve to a real file: repo-root-absolute markdown links `](/path)`
// and bare code-span paths
// `top-dir/…/file.ext` under a known layer root. Fenced code blocks are illustrative and
// exempt; entry-file placeholders (`…-nnnn.md`) and angle-bracket templates are not real
// paths. It checks existence, not that the target's content is correct.
const REF_ROOTS = ['corpus', 'skills', 'roles', 'tools', 'tenant-incident', 'tenant-build'];
const ABS_LINK_RE = /\]\((\/[A-Za-z0-9._/-]+)(#[^)]*)?\)/g;
const BARE_PATH_RE = new RegExp(
  '`((?:' + REF_ROOTS.join('|') + ')/[A-Za-z0-9._/-]+\\.(?:md|sh|ts|yml|yaml))`',
  'g',
);

// A path segment the author wrote as a stand-in, not a file that exists: the entry-file
// placeholder `<PREFIX>-nnnn.md` and any `<angle-bracket>` template token.
function isPlaceholderPath(p: string): boolean {
  return p.includes('nnnn') || p.includes('<') || p.includes('>');
}

// The files whose references this rule resolves: the LANGUAGE-governed prose (corpus, skills,
// roles) plus the tool protocols under tools/*.md (INDEX-CONTRACT.md is a binding interface
// that names companion paths). walkMarkdown skips non-.md, so tools/*.ts and *.test.ts are not
// scanned — the rule reads protocols, not code.
function filesWithReferences(root: string): string[] {
  const out = languageGovernedFiles(root);
  walkMarkdown(join(root, 'tools'), root, out);
  return [...new Set(out)].sort();
}

function refsResolve(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const relPath of filesWithReferences(ctx.root)) {
    const text = read(ctx.root, relPath).replace(/```[\s\S]*?```/g, blankOut);
    const seen = new Map<string, number>(); // target -> first line, deduped within a file
    const addRef = (raw: string, index: number) => {
      const clean = raw.replace(/^\//, '').split('#')[0] ?? '';
      if (clean === '' || isPlaceholderPath(clean)) return;
      if (!seen.has(clean)) seen.set(clean, lineAt(text, index));
    };
    for (const m of text.matchAll(ABS_LINK_RE)) if (m[1] !== undefined) addRef(m[1], m.index ?? 0);
    for (const m of text.matchAll(BARE_PATH_RE)) if (m[1] !== undefined) addRef(m[1], m.index ?? 0);
    for (const [target, line] of seen) {
      // A '..' segment escapes the repo root: joining it to ctx.root resolves outside the
      // checkout, so existence would depend on unrelated sibling files. Reject it as a
      // malformed reference rather than let the environment decide (a repo-root reference has
      // no reason to climb out). Checked before existsSync so nothing outside is ever probed.
      if (target.split('/').includes('..')) {
        findings.push({
          rule: 'refs-resolve',
          file: relPath,
          line,
          severity: 'error',
          message: `references '${target}', which escapes the repository root — name a file by its repo-root path, no '..' (BS-0010)`,
        });
        continue;
      }
      if (!existsSync(join(ctx.root, target))) {
        findings.push({
          rule: 'refs-resolve',
          file: relPath,
          line,
          severity: 'error',
          message: `references '${target}', which does not exist — ship every file a procedure names, at least header-only (BS-0010)`,
        });
      }
    }
  }
  return ok(findings);
}

// R13 — cross-root id uniqueness. Multi-root discovery admits the canonical filename from every
// corpus root, so an id minted under two roots resolves to two entries — an ambiguous record set
// the index would render as two identical rows and every gate reading it would accept. A canonical
// id must resolve to exactly one entry path; the finding names every path that claims the id.
function uniqueId(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  for (const store of ENTRY_STORES) {
    for (const [id, paths] of admittedById(ctx.root, store)) {
      if (paths.length < 2) continue;
      for (const p of paths) {
        findings.push({
          rule: 'unique-id',
          file: p,
          severity: 'error',
          message: `id '${id}' is claimed by ${paths.length} entries across corpus roots (${paths.join(', ')}) — an id must resolve to one entry`,
        });
      }
    }
  }
  return ok(findings);
}

// R14 — derived-quantity (BS-0040, hardcoded-assumption; LANGUAGE.md reference discipline).
// A recency or size literal in governed prose is the greppable form of a magic constant pinned
// where the case names the quantity ("the last day" beside a symptom-window requirement). Warn,
// not error: some constants are genuinely fixed facts (a spec width, a quota), so this is the
// author's cue to derive or to state the figure as a fact — the TELL_WARNINGS posture. The
// open-sample form of the same failure (an exhaustive removal set stated as a few examples) is
// not lexically separable from a legitimate list and stays review judgment (residue).
const RECENCY_LITERAL = /\bthe (?:last|past|previous)\s+\d*\s*(?:day|days|hour|hours|week|weeks|month|months|minute|minutes)\b/gi;
const CUTOFF_LITERAL = /\b\d+\s*-?\s*(?:h|hr|hrs|hour|hours)\b|\b\d+\s*-?\s*(?:day|days|week|weeks|month|months)\s*(?:window|cutoff|lookback|recency|ago)\b/gi;

function derivedQuantity(ctx: Ctx): RuleResult {
  const findings: Finding[] = [];
  const message =
    'recency/size literal — derive the bound from the case the procedure names, or state it as a fixed fact when the case does not touch it (LANGUAGE.md reference discipline)';
  for (const relPath of languageGovernedFiles(ctx.root)) {
    // LANGUAGE.md defines this pattern in its own examples ("the last day", "24h"); scanning it
    // flags the rule's own specification (self-match, BS-0004/0022). Its examples are quoted.
    if (relPath === 'corpus/LANGUAGE.md') continue;
    const text = stripCodeSpans(read(ctx.root, relPath));
    // The two patterns overlap: "the last 24 hours" matches RECENCY_LITERAL whole and
    // CUTOFF_LITERAL on the "24 hours" inside it. One literal is one cue, so collect every
    // match span and emit a single warning per overlapping cluster (Qodo #19) — a distinct,
    // non-overlapping literal still warns on its own.
    const spans: Array<[number, number]> = [];
    for (const re of [RECENCY_LITERAL, CUTOFF_LITERAL]) {
      for (const m of text.matchAll(re)) {
        const start = m.index ?? 0;
        spans.push([start, start + m[0].length]);
      }
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let coveredEnd = -1;
    for (const [start, end] of spans) {
      if (start < coveredEnd) {
        coveredEnd = Math.max(coveredEnd, end);
        continue; // overlaps a literal already reported at this location
      }
      findings.push({ rule: 'derived-quantity', file: relPath, line: lineAt(text, start), severity: 'warn', message });
      coveredEnd = end;
    }
  }
  return ok(findings);
}

// ── shared collectors ──

function collect(findings: Finding[], rule: string, file: string, text: string, re: RegExp, message: string, severity: Severity): void {
  for (const m of text.matchAll(re)) {
    findings.push({ rule, file, line: lineAt(text, m.index ?? 0), severity, message });
  }
}

function msg(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// ── registry ──

export const RULES: Rule[] = [
  { name: 'index-current', run: indexCurrent, residue: ['assumes valid entries; checks only that the generated region matches a fresh render — not that the fields chosen are the right ones (INDEX-CONTRACT.md).'] },
  { name: 'five-slot', run: fiveSlot, residue: ['checks slot presence and count, not that a section says anything true, that ≥2 warrant IDs are real and cross-surface, or that a falsifier tests the right quantity.', "moot-when (the decisions/rules retirement slot) presence is NOT enforced — it may be legitimately absent (a rule may exit by coverage migration); disclosed, and flagged for the SCHEMA author."] },
  { name: 'tombstone', run: tombstone, residue: ['checks a successor pointer is present on retirement, not that the pointed-to entry exists or is the right successor.'] },
  { name: 'constitution-cap', run: constitutionCap, residue: ['counts articles by marker; does not verify eviction was actually performed, only the resulting count. Targets the shipped skill, never planning/.'] },
  { name: 'frozen-path', run: frozenPath, residue: ['freezes body bytes and non-lifecycle frontmatter against the merge-base, per store, across every corpus root (layer ledgers and the build ADR store, each on its own mutable-key contract); does not verify a status flip was warranted or that a successor exists. UNCHECKED when no base ref resolves, or when the resolved base equals HEAD (a self-compare — see skips) — CI must pass the pre-change base per event.'] },
  { name: 'no-duty-language', run: noDutyLanguage, residue: ["keys on the literal 'fires-when'; duty phrasing written without that token (e.g. 'always check…') is review judgment."] },
  { name: 'banned-tell', run: bannedTell, residue: ['lexical match over layer prose, the build ADR store, and incident-tenant *.md (fixtures excluded); cannot distinguish a genuine tell from a rare legitimate word — common-word tells are non-failing warnings. LANGUAGE.md’s L1 tables and quoted examples are excluded (it defines the tells); its prose is still scanned for hard tells.'] },
  { name: 'date-format', run: dateFormat, residue: ['flags malformed date shapes; does not check a date is real, correct, or that a needed date is present. A capitalized month word before a number may false-positive.'] },
  { name: 'do-dont', run: doDontPairing, residue: ['checks pairing and adjacency across SCHEMAs, skill packs, and role templates, not that a Don’t names a real, non-vacuous overshoot (LANGUAGE.md L3’s own residue).'] },
  { name: 'readme-kind', run: readmeKind, residue: ['checks the register/ledger declaration is present, not that the store behaves as declared.'] },
  { name: 'escapes', run: escapesValid, residue: ['checks escape syntax other(<what>), not that the escape was the right call over a named term.'] },
  { name: 'refs-resolve', run: refsResolve, residue: ['over layer prose (corpus/skills/roles), both tenant trees, and tools/*.md protocols, checks repo-root-absolute markdown links and bare code-span layer paths resolve (and reject `..`); does not check the target content is right, nor catch a path named in prose without link or code-span syntax. Fenced code and `…-nnnn.md` placeholders are exempt.'] },
  { name: 'check-seam', run: checkSeam, residue: ['greps a DERIVED tenant-term set; cannot catch tenant knowledge expressed without a registered term (paraphrase), and coverage grows only as the vocabulary does. A no-op until the tenant grows terms/scenarios. Excludes *.test.ts (fixtures) and the tenant-build tree (its subject is the layer — tenant→layer references are allowed).'] },
  { name: 'unique-id', run: uniqueId, residue: ['checks that each admitted id resolves to one entry path across all corpus roots; does not check the id was minted correctly or that its content is right. Keyed on the admitted-filename shape, so a draft (no minted id) is out of scope.'] },
  { name: 'derived-quantity', run: derivedQuantity, residue: ["warns on a recency/size literal's SHAPE in governed prose, not on whether the constant should derive from the case — a genuinely fixed figure (a spec width, a quota) is a legitimate fact. Does not reach the open-sample form of the same failure (an exhaustive removal set stated as examples), which is not lexically separable from a legitimate list. LANGUAGE.md's own examples are exempt (self-definition)."] },
];

const GLOBAL_RESIDUE = [
  'corpus-lint checks PRESENCE and SHAPE, never quality or truth — a deliberate, disclosed floor (Constitution Art. 8, ISO §15).',
  'The frontmatter reader here preserves array/map fields the index projection drops; it is not a reimplementation of index-contract.',
];

// ── driver ──

export function lint(ctx: Ctx, only?: string[]): { findings: Finding[]; skips: Skip[] } {
  const rules = only ? RULES.filter((r) => only.includes(r.name)) : RULES;
  const findings: Finding[] = [];
  const skips: Skip[] = [];
  for (const rule of rules) {
    const res = rule.run(ctx);
    findings.push(...res.findings);
    skips.push(...res.skips);
  }
  return { findings, skips };
}

function repoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.cwd();
  }
}

function report(findings: Finding[], skips: Skip[], residue: string[]): number {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warn');
  const order = (f: Finding) => `${f.file}:${f.line ?? 0}`;
  for (const f of [...errors].sort((a, b) => order(a).localeCompare(order(b)))) {
    process.stdout.write(`FAIL  ${f.rule.padEnd(16)} ${f.file}${f.line ? ':' + f.line : ''}  ${f.message}\n`);
  }
  for (const f of [...warnings].sort((a, b) => order(a).localeCompare(order(b)))) {
    process.stdout.write(`warn  ${f.rule.padEnd(16)} ${f.file}${f.line ? ':' + f.line : ''}  ${f.message}\n`);
  }
  for (const s of skips) {
    process.stdout.write(`skip  ${s.rule.padEnd(16)} ${s.reason}\n`);
  }
  process.stdout.write(`\n${errors.length} error(s), ${warnings.length} warning(s), ${skips.length} skip(s)\n`);

  process.stdout.write('\nResidue — what corpus-lint does NOT check:\n');
  for (const line of residue) process.stdout.write(`  - ${line}\n`);
  for (const rule of RULES) for (const line of rule.residue) process.stdout.write(`  - [${rule.name}] ${line}\n`);

  return errors.length > 0 ? 1 : 0;
}

function main(argv: string[]): number {
  const only = argv.includes('--check-seam') ? ['check-seam'] : undefined;
  const baseIdx = argv.indexOf('--base');
  const baseRef = baseIdx !== -1 ? argv[baseIdx + 1] : undefined;
  const ctx: Ctx = { root: repoRoot(), baseRef };
  const { findings, skips } = lint(ctx, only);
  return report(findings, skips, GLOBAL_RESIDUE);
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
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (cause) {
    process.stderr.write(`corpus-lint: internal error: ${msg(cause)}\n`);
    process.exit(2);
  }
}
