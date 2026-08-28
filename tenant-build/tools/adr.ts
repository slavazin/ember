// adr — on-demand projector and validator for the build ADR store (no committed index).
//
//   adr index [--status=S] [--scope=PATH] [--related=ADR-nnnn]
//   adr related <ADR-nnnn>
//   adr scopes [PATH…]      (default: the paths changed on this branch)
//   adr check
//
// The store reads live; there is no generated index to keep current. Run through the
// repository's tsx toolchain (see the `adr` npm script).

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATUSES,
  type Adr,
  type Status,
  type Lineage,
  type GitRunner,
  loadCorpus,
  checkCorpus,
  indexView,
  relatedView,
  scopesView,
  discoverChangedPaths,
} from './adr-lib.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_DIR = join(ROOT, 'tenant-build', 'corpus', 'decisions');
const ID_RE = /^ADR-\d{4}$/;

function fail(message: string): never {
  process.stderr.write(`adr: ${message}\n`);
  process.exit(2);
}

/** Split argv into positionals and --k=v flags; a flag outside `allowed` is a hard error. */
function parseArgs(argv: string[], allowed: readonly string[]): { positionals: string[]; flags: Map<string, string> } {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) fail(`flag ${arg} needs a value as --flag=value`);
      const key = arg.slice(2, eq);
      const value = arg.slice(eq + 1);
      if (!allowed.includes(key)) fail(`unknown flag --${key}`);
      if (value === '') fail(`flag --${key} needs a non-empty value`);
      flags.set(key, value);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function load(): Adr[] {
  const { adrs, fileErrors } = loadCorpus(STORE_DIR);
  if (fileErrors.length > 0) {
    // A malformed entry would corrupt every projection; refuse to project over a broken store.
    process.stderr.write('adr: the store has shape errors; run `adr check`\n');
    for (const e of fileErrors) process.stderr.write(`  ${e.file}: ${e.message}\n`);
    process.exit(1);
  }
  return adrs;
}

function cmdIndex(argv: string[]): void {
  const { positionals, flags } = parseArgs(argv, ['status', 'scope', 'related']);
  if (positionals.length > 0) fail(`index takes no positional arguments (got ${positionals[0]})`);
  const filter: { status?: Status; scope?: string; related?: string } = {};
  const status = flags.get('status');
  if (status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(status)) fail(`--status must be one of ${STATUSES.join(' | ')}`);
    filter.status = status as Status;
  }
  const scope = flags.get('scope');
  if (scope !== undefined) filter.scope = scope;
  const related = flags.get('related');
  if (related !== undefined) {
    if (!ID_RE.test(related)) fail('--related must be a canonical ADR-nnnn id');
    filter.related = related;
  }
  for (const line of indexView(load(), filter)) process.stdout.write(`${line}\n`);
}

function cmdRelated(argv: string[]): void {
  const { positionals, flags } = parseArgs(argv, []);
  if (flags.size > 0) fail('related takes no flags');
  if (positionals.length !== 1) fail('related takes exactly one ADR-nnnn id');
  const id = positionals[0] as string;
  if (!ID_RE.test(id)) fail(`"${id}" is not a canonical ADR-nnnn id`);
  const lineage = relatedView(load(), id);
  if (lineage.missing) fail(`${id} resolves to no entry`);
  printLineage(id, lineage);
}

function printLineage(id: string, lineage: Lineage): void {
  const line = (a: Adr, rel?: string) =>
    `${rel ? rel.padEnd(15) : ''}${a.id} [${a.status}] — ${a.summary}`;
  if (lineage.target) process.stdout.write(`${line(lineage.target)}\n`);
  process.stdout.write('outbound:\n');
  if (lineage.outbound.length === 0) process.stdout.write('  (none)\n');
  for (const e of lineage.outbound) process.stdout.write(`  ${line(e.adr, e.relation)}\n`);
  process.stdout.write(`inbound (${lineage.inbound.length} cite ${id}):\n`);
  for (const e of lineage.inbound) process.stdout.write(`  ${line(e.adr, e.relation)}\n`);
}

function cmdScopes(argv: string[]): void {
  const { positionals, flags } = parseArgs(argv, []);
  if (flags.size > 0) fail('scopes takes no flags');
  const paths = positionals.length > 0 ? positionals : changedPaths();
  if (paths.length === 0) {
    process.stderr.write('adr: no paths given and none changed on this branch\n');
    return;
  }
  const hits = scopesView(load(), paths);
  for (const hit of hits) {
    if (hit.adrs.length === 0) continue;
    process.stdout.write(`${hit.path}\n`);
    for (const a of hit.adrs) process.stdout.write(`  ${a.id} [${a.status}] — ${a.summary}\n`);
  }
}

/** Paths changed on this branch (tracked diff ∪ untracked); empty if git is unavailable. */
function changedPaths(): string[] {
  const runGit: GitRunner = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return undefined;
    }
  };
  return discoverChangedPaths(runGit);
}

function cmdCheck(argv: string[]): void {
  const { positionals, flags } = parseArgs(argv, []);
  if (positionals.length > 0 || flags.size > 0) fail('check takes no arguments');
  const { adrs, fileErrors } = loadCorpus(STORE_DIR);
  const problems = [...fileErrors, ...checkCorpus(adrs)];
  if (problems.length === 0) {
    process.stdout.write(`adr check: ${adrs.length} entries, 0 problems\n`);
    return;
  }
  for (const p of problems) process.stderr.write(`${p.file}: ${p.message}\n`);
  process.stderr.write(`adr check: ${problems.length} problem(s)\n`);
  process.exit(1);
}

function main(): void {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'index':
      return cmdIndex(rest);
    case 'related':
      return cmdRelated(rest);
    case 'scopes':
      return cmdScopes(rest);
    case 'check':
      return cmdCheck(rest);
    default:
      fail(`unknown command "${cmd ?? ''}" — use index | related | scopes | check`);
  }
}

main();
