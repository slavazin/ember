// index-gen — the store-index producer. A thin driver over tools/index-contract.ts:
// for each store it discovers the entry files, parses each through the shared module,
// renders the deterministic index block, and splices it into the hosting SKILL.md.
// The module owns parsing, rendering, the markers, sorting, and determinism; this file
// owns only filesystem IO and the CLI. The governing spec is tools/INDEX-CONTRACT.md.
//
// CLI:
//   node --import tsx tools/index-gen.ts            write every store's region in place
//   node --import tsx tools/index-gen.ts --check    name stale stores, write nothing,
//                                                    exit non-zero on any divergence
//                                                    (the CI form)

import { readFileSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INDEX_STORES,
  INDEX_TARGETS,
  parseEntry,
  renderIndexBlock,
  spliceIndexBlock,
  type StoreId,
  type IndexRecord,
} from './index-contract.ts';

// The id prefix each store's entry files carry, per the store SCHEMAs
// (corpus/<store>/SCHEMA.md fixes D-nnnn.md / R-nnnn.md / B-nnnn.md). Discovery keys on
// this shape, so README.md and SCHEMA.md never match it.
const STORE_PREFIX: Record<StoreId, string> = {
  decisions: 'D',
  rules: 'R',
  beliefs: 'B',
};

// A store's entry directory, relative to the repo root — the form used in messages.
function storeDirRel(store: StoreId): string {
  return `corpus/${store}`;
}

// Entry-file names in a store, sorted lexically. The module sorts records by id at
// render time, so the written bytes are stable regardless of directory-read order; the
// lexical pre-sort makes iteration and error reporting deterministic and fixes the
// order of any two entries that share an id integer.
export function discoverEntryFiles(root: string, store: StoreId): string[] {
  const relDir = storeDirRel(store);
  let names: string[];
  try {
    names = readdirSync(join(root, relDir));
  } catch (e) {
    if (errCode(e) === 'ENOENT') throw new Error(`store directory not found: ${relDir}`);
    throw new Error(`cannot read store directory ${relDir}: ${detail(e)}`);
  }
  const pattern = new RegExp(`^${STORE_PREFIX[store]}-\\d+\\.md$`);
  return names.filter((name) => pattern.test(name)).sort();
}

// Read and parse every entry file in a store into the records the index needs.
// parseEntry (the module) reads frontmatter and the title only, so no payload section
// can reach a record. An entry that matches the filename shape but carries no `id` is a
// hard error naming the file — never a silent skip. A verifier reuses this to read the
// entries the same way index-gen does, rather than duplicating the discovery.
export function collectRecords(root: string, store: StoreId): IndexRecord[] {
  return discoverEntryFiles(root, store).map((name) => {
    const rel = `${storeDirRel(store)}/${name}`;
    let text: string;
    try {
      text = readFileSync(join(root, storeDirRel(store), name), 'utf8');
    } catch (e) {
      throw new Error(`cannot read ${rel}: ${detail(e)}`);
    }
    try {
      return parseEntry(store, text);
    } catch (e) {
      throw new Error(`${rel}: ${detail(e)}`);
    }
  });
}

export interface StorePlan {
  store: StoreId;
  target: string; // repo-relative host SKILL.md
  before: string;
  after: string;
  current: boolean;
}

// Regenerate a store's index against its host SKILL.md without writing. Reads the
// entries and the host, renders the block, and splices it in. Throws when the host is
// absent (naming it) or its markers are missing or malformed (the module's check). The
// splice is idempotent, so `current` is exactly whether a write would change any bytes.
export function planStore(root: string, store: StoreId): StorePlan {
  const records = collectRecords(root, store);
  const block = renderIndexBlock(store, records);
  const target = INDEX_TARGETS[store];
  let before: string;
  try {
    before = readFileSync(join(root, target), 'utf8');
  } catch (e) {
    if (errCode(e) === 'ENOENT') throw new Error(`target SKILL.md not found: ${target}`);
    throw new Error(`cannot read target ${target}: ${detail(e)}`);
  }
  const after = spliceIndexBlock(before, store, block);
  return { store, target, before, after, current: after === before };
}

export type Outcome =
  | { store: StoreId; target: string; kind: 'written' | 'unchanged' | 'stale' }
  | { store: StoreId; target: string; kind: 'error'; detail: string };

// Process one store. In check mode a stale region is reported, never written; in write
// mode a stale region is rewritten in place. Any failure — absent host, malformed
// markers, an unparseable entry — becomes an error outcome, so one bad store never masks
// the others and the report can name every problem at once.
export function processStore(root: string, store: StoreId, check: boolean): Outcome {
  const target = INDEX_TARGETS[store];
  try {
    const plan = planStore(root, store);
    if (plan.current) return { store, target: plan.target, kind: 'unchanged' };
    if (check) return { store, target: plan.target, kind: 'stale' };
    writeFileSync(join(root, plan.target), plan.after, 'utf8');
    return { store, target: plan.target, kind: 'written' };
  } catch (e) {
    return { store, target, kind: 'error', detail: detail(e) };
  }
}

// The CLI core minus process control: returns an exit code and a report, so it is unit
// testable. Write mode updates each stale host in place; every store maps to a distinct
// file, so a run that errors on one store leaves the others correctly written and no
// file half-written — a re-run is clean. Check mode writes nothing.
export function run(root: string, argv: readonly string[]): { code: number; report: string } {
  const check = argv.includes('--check');
  const unknown = argv.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    return {
      code: 2,
      report: `index-gen: unrecognized argument(s): ${unknown.join(', ')}\nusage: index-gen [--check]`,
    };
  }

  const outcomes = INDEX_STORES.map((store) => processStore(root, store, check));
  const errors = outcomes.filter((o) => o.kind === 'error').length;
  const stale = outcomes.filter((o) => o.kind === 'stale').length;
  const written = outcomes.filter((o) => o.kind === 'written').length;

  const lines = outcomes.map((o) => {
    switch (o.kind) {
      case 'error':
        return `  ${o.store} error → ${o.target}: ${o.detail}`;
      case 'stale':
        return `  ${o.store} stale → ${o.target}`;
      case 'written':
        return `  ${o.store} written → ${o.target}`;
      case 'unchanged':
        return `  ${o.store} unchanged → ${o.target}`;
    }
  });

  let head: string;
  let code: number;
  if (check) {
    code = stale + errors === 0 ? 0 : 1;
    head =
      code === 0
        ? `index-gen --check: all ${outcomes.length} store(s) current`
        : `index-gen --check: ${stale} stale, ${errors} error(s)`;
  } else {
    code = errors === 0 ? 0 : 1;
    head = `index-gen: ${written} written, ${outcomes.length - written - errors} unchanged, ${errors} error(s)`;
  }

  return { code, report: [head, ...lines].join('\n') };
}

function detail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The `code` off a Node IO error, when present — used to tell a genuinely absent file
// (ENOENT) from other read failures, which keep their native message.
function errCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code?: unknown }).code)
    : undefined;
}

// The repo root, resolved from this file's own location (tools/index-gen.ts -> root), so
// the CLI reads and writes the same paths whatever the working directory.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// True only when this file is the process entry point — so importing the module (a test,
// or a verifier) never triggers the CLI.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const { code, report } = run(REPO_ROOT, process.argv.slice(2));
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(report.endsWith('\n') ? report : `${report}\n`);
  // Set the code rather than calling process.exit, so a piped report drains before exit.
  process.exitCode = code;
}
