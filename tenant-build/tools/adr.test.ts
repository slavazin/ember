import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isEntryFile,
  parseAdrFile,
  checkCorpus,
  loadCorpus,
  indexView,
  relatedView,
  scopesView,
  discoverChangedPaths,
  type Adr,
} from './adr-lib.ts';

// A minimal valid entry text, overridable field-by-field via a frontmatter string + summary.
// Carries every required body section so a valid fixture is genuinely schema-complete.
function entry(front: string, summary = 'a decision that routes but does not obey'): string {
  return (
    `---\n${front}\n---\n# ${summary}\n\n` +
    `## Context\nThe forces.\n\n## Decision\nThe constraint.\n\n` +
    `## Consequences\nWhat it enables.\n\n## Warrant\n- False if: the premise reverses.\n`
  );
}

function adr(overrides: Partial<Adr> & { id: string; file?: string }): Adr {
  return {
    status: 'accepted',
    convergedInto: [],
    scopes: [],
    related: [],
    backfilled: false,
    decided: '2026-08-28',
    summary: overrides.summary ?? 'summary',
    file: overrides.file ?? `${overrides.id}.md`,
    ...overrides,
  } as Adr;
}

// ── isEntryFile: exact four digits, never widened (loose-acceptance) ──

test('isEntryFile matches only the canonical four-digit shape', () => {
  assert.ok(isEntryFile('ADR-0007.md'));
  assert.ok(!isEntryFile('ADR-7.md'));
  assert.ok(!isEntryFile('ADR-00007.md'));
  assert.ok(!isEntryFile('D-0007.md'));
  assert.ok(!isEntryFile('ADR-0007.txt'));
  assert.ok(!isEntryFile('README.md'));
});

// ── parseAdrFile: presence + domain, not presence alone (partial-contract) ──

test('a well-formed entry parses with no errors', () => {
  const { adr: a, errors } = parseAdrFile(
    'ADR-0007.md',
    entry('id: ADR-0007\nstatus: accepted\nscopes: [tools/]\nrelated: []\nbackfilled: true\ndecided: 2026-08-28'),
  );
  assert.deepEqual(errors, []);
  assert.equal(a.id, 'ADR-0007');
  assert.equal(a.status, 'accepted');
  assert.deepEqual(a.scopes, ['tools/']);
  assert.equal(a.backfilled, true);
  assert.equal(a.summary, 'a decision that routes but does not obey');
});

test('missing frontmatter is an error', () => {
  const { errors } = parseAdrFile('ADR-0007.md', '# just a title\n');
  assert.deepEqual(errors, ['no frontmatter block']);
});

test('an unknown frontmatter key is rejected (a dropped-edge typo)', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\nsupersede: ADR-0001'));
  assert.ok(errors.some((e) => e.includes('unknown frontmatter key: supersede')));
});

test('status outside the closed set is rejected', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: ADR-0007\nstatus: nonsense\ndecided: 2026-08-28'));
  assert.ok(errors.some((e) => e.includes('status "nonsense"')));
});

test('a non-canonical id is rejected', () => {
  const { errors } = parseAdrFile('ADR-7.md', entry('id: ADR-7\nstatus: accepted\ndecided: 2026-08-28'));
  assert.ok(errors.some((e) => e.includes('not canonical')));
});

test('backfilled must be the literal true when present', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\nbackfilled: maybe'));
  assert.ok(errors.some((e) => e.includes('backfilled')));
});

test('a list field carrying a scalar is a shape error (coarse-shape)', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\nscopes: tools/'));
  assert.ok(errors.some((e) => e.includes('scopes must be a list')));
});

test('a bad date format is rejected', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: ADR-0007\nstatus: accepted\ndecided: Aug 28 2026'));
  assert.ok(errors.some((e) => e.includes('not YYYY-MM-DD')));
});

test('a missing summary line is an error', () => {
  const noSummary = '---\nid: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\n---\n\n## Decision\nx\n';
  const { errors } = parseAdrFile('ADR-0007.md', noSummary);
  assert.ok(errors.some((e) => e.includes('summary')));
});

test('an entry missing a required body section is rejected (a summary alone is not schema-valid)', () => {
  const noWarrant =
    '---\nid: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\n---\n# a real summary\n\n' +
    '## Context\nx\n\n## Decision\ny\n\n## Consequences\nz\n';
  const { errors } = parseAdrFile('ADR-0007.md', noWarrant);
  assert.ok(errors.some((e) => e.includes('missing required section: ## Warrant')));
  // Options considered is optional — its absence is not an error.
  assert.ok(!errors.some((e) => e.includes('Options')));
});

test('a present non-string scalar field is a shape error, not silent absence (dropped edge)', () => {
  const asList = parseAdrFile(
    'ADR-0007.md',
    entry('id: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\nsupersedes: [ADR-0001]'),
  );
  assert.ok(asList.errors.some((e) => e.includes('supersedes must be a scalar string')));
  const asMap = parseAdrFile(
    'ADR-0007.md',
    entry('id: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\npromoted-to:\n  a: b'),
  );
  assert.ok(asMap.errors.some((e) => e.includes('promoted-to must be a scalar string')));
});

test('a present non-string required field errors once, not as both bad-type and missing', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: [ADR-0007]\nstatus: accepted\ndecided: 2026-08-28'));
  assert.equal(errors.filter((e) => e.startsWith('id ')).length, 1);
  assert.ok(errors.some((e) => e.includes('id must be a scalar string')));
  assert.ok(!errors.some((e) => e.includes('id is required')));
});

test('an empty optional scalar is treated as absent, not an error', () => {
  const { errors } = parseAdrFile('ADR-0007.md', entry('id: ADR-0007\nstatus: accepted\ndecided: 2026-08-28\npromoted-to:'));
  assert.deepEqual(errors, []);
});

// ── checkCorpus: identity + reciprocity + resolution (split-identity, dangling-reference) ──

test('a filename that disagrees with the id fails', () => {
  const problems = checkCorpus([adr({ id: 'ADR-0007', file: 'ADR-0008.md' })]);
  assert.ok(problems.some((p) => p.message.includes('filename must equal ADR-0007.md')));
});

test('a valid supersession pair is reciprocal and clean', () => {
  const problems = checkCorpus([
    adr({ id: 'ADR-0001', status: 'superseded', supersededBy: 'ADR-0002' }),
    adr({ id: 'ADR-0002', supersedes: 'ADR-0001' }),
  ]);
  assert.deepEqual(problems, []);
});

test('superseded without a back-pointer target fails both directions', () => {
  const problems = checkCorpus([
    adr({ id: 'ADR-0001', status: 'superseded', supersededBy: 'ADR-0002' }),
    adr({ id: 'ADR-0002' }), // does not name ADR-0001 in supersedes
  ]);
  assert.ok(problems.some((p) => p.message.includes('does not name ADR-0001 in supersedes')));
});

test('status superseded requires superseded-by', () => {
  const problems = checkCorpus([adr({ id: 'ADR-0001', status: 'superseded' })]);
  assert.ok(problems.some((p) => p.message.includes('requires superseded-by')));
});

test('a terminal moot entry needs no successor (lifecycle is not globalized)', () => {
  const problems = checkCorpus([adr({ id: 'ADR-0001', status: 'moot' })]);
  assert.deepEqual(problems, []);
});

test('superseded-by set on a non-superseded entry fails', () => {
  const problems = checkCorpus([
    adr({ id: 'ADR-0001', status: 'accepted', supersededBy: 'ADR-0002' }),
    adr({ id: 'ADR-0002', supersedes: 'ADR-0001' }),
  ]);
  assert.ok(problems.some((p) => p.message.includes('superseded-by set but status is accepted')));
});

test('converged requires converged-into, and the ids must resolve', () => {
  const missingList = checkCorpus([adr({ id: 'ADR-0001', status: 'converged' })]);
  assert.ok(missingList.some((p) => p.message.includes('requires converged-into')));
  const dangling = checkCorpus([adr({ id: 'ADR-0001', status: 'converged', convergedInto: ['ADR-9999'] })]);
  assert.ok(dangling.some((p) => p.message.includes('ADR-9999 resolves to no entry')));
});

test('a dangling or self related reference fails', () => {
  const dangling = checkCorpus([adr({ id: 'ADR-0001', related: ['ADR-9999'] })]);
  assert.ok(dangling.some((p) => p.message.includes('related ADR-9999 resolves to no entry')));
  const self = checkCorpus([adr({ id: 'ADR-0001', related: ['ADR-0001'] })]);
  assert.ok(self.some((p) => p.message.includes('lists the entry itself')));
});

// ── queries ──

test('indexView sorts by id and filters by status and scope', () => {
  const corpus = [
    adr({ id: 'ADR-0002', status: 'superseded', supersededBy: 'ADR-0003', scopes: ['tools/corpus-lint.ts'] }),
    adr({ id: 'ADR-0001', scopes: ['skills/'] }),
    adr({ id: 'ADR-0003', supersedes: 'ADR-0002', scopes: ['tools/'] }),
  ];
  const all = indexView(corpus);
  assert.match(all[0] ?? '', /^ADR-0001/);
  assert.match(all[2] ?? '', /^ADR-0003/);
  assert.equal(indexView(corpus, { status: 'superseded' }).length, 1);
  // scope filter is segment-aware and bidirectional: querying tools/ finds both tools/ entries.
  const scoped = indexView(corpus, { scope: 'tools/' });
  assert.equal(scoped.length, 2);
});

test('scopesView matches a governing prefix but not a sibling with a shared stem', () => {
  const corpus = [adr({ id: 'ADR-0001', scopes: ['tools/'] })];
  assert.equal(scopesView(corpus, ['tools/corpus-lint.ts'])[0]?.adrs.length, 1);
  assert.equal(scopesView(corpus, ['toolsX/other.ts'])[0]?.adrs.length, 0);
  assert.equal(scopesView(corpus, ['docs/readme.md'])[0]?.adrs.length, 0);
});

test('relatedView returns outbound edges and inbound citers', () => {
  const corpus = [
    adr({ id: 'ADR-0004', status: 'superseded', supersededBy: 'ADR-0005' }),
    adr({ id: 'ADR-0005', supersedes: 'ADR-0004', related: ['ADR-0006'] }),
    adr({ id: 'ADR-0006', related: ['ADR-0005'] }),
  ];
  const lineage = relatedView(corpus, 'ADR-0005');
  assert.equal(lineage.missing, false);
  assert.ok(lineage.outbound.some((e) => e.relation === 'supersedes' && e.adr.id === 'ADR-0004'));
  assert.ok(lineage.outbound.some((e) => e.relation === 'related' && e.adr.id === 'ADR-0006'));
  assert.ok(lineage.inbound.some((e) => e.adr.id === 'ADR-0006'));
  assert.equal(relatedView(corpus, 'ADR-9999').missing, true);
});

// ── discoverChangedPaths: the default scopes input includes untracked files ──

test('discoverChangedPaths unions tracked diff with untracked files and dedupes, tracked first', () => {
  const responses = new Map<string, string>([
    ['merge-base HEAD origin/main', 'abc123\n'],
    ['diff --name-only abc123', 'tools/a.ts\nshared.ts\n'],
    ['ls-files --others --exclude-standard', 'tenant-build/new.md\nshared.ts\n'],
  ]);
  const runGit = (args: string[]): string | undefined => responses.get(args.join(' '));
  const result = discoverChangedPaths(runGit);
  assert.deepEqual(result.paths, ['tools/a.ts', 'shared.ts', 'tenant-build/new.md']);
  assert.equal(result.baseResolved, true);
});

test('discoverChangedPaths uses local main when origin/main is absent', () => {
  const responses = new Map<string, string>([
    ['merge-base HEAD main', 'def456\n'],
    ['diff --name-only def456', 'tools/b.ts\n'],
  ]);
  const runGit = (args: string[]): string | undefined => responses.get(args.join(' '));
  const result = discoverChangedPaths(runGit);
  assert.deepEqual(result.paths, ['tools/b.ts']);
  assert.equal(result.baseResolved, true);
});

test('discoverChangedPaths reports base unresolved rather than silently diffing against HEAD', () => {
  // No mainline ref resolves; diffing HEAD would omit committed branch changes (BS-0023).
  const runGit = (args: string[]): string | undefined =>
    args[0] === 'diff' ? 'only-uncommitted.ts\n' : undefined;
  const result = discoverChangedPaths(runGit);
  assert.equal(result.baseResolved, false);
  assert.deepEqual(result.paths, ['only-uncommitted.ts']);
});

// ── loadCorpus over a temp store, and the empty case ──

test('loadCorpus reads only entry files and reports shape errors per file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-'));
  try {
    writeFileSync(join(dir, 'ADR-0001.md'), entry('id: ADR-0001\nstatus: accepted\ndecided: 2026-08-28'));
    writeFileSync(join(dir, 'ADR-0002.md'), entry('id: ADR-0002\nstatus: bogus\ndecided: 2026-08-28'));
    writeFileSync(join(dir, 'README.md'), '# not an entry\n');
    const { adrs, fileErrors } = loadCorpus(dir);
    assert.equal(adrs.length, 2); // README.md excluded
    assert.ok(fileErrors.some((e) => e.file === 'ADR-0002.md' && e.message.includes('status')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty store loads cleanly and projects nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-'));
  try {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const { adrs, fileErrors } = loadCorpus(dir);
    assert.deepEqual(adrs, []);
    assert.deepEqual(fileErrors, []);
    assert.deepEqual(indexView(adrs), []);
    assert.deepEqual(checkCorpus(adrs), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the shipped seed store validates (example-validity): the entries we ship pass check ──

test('the shipped seed ADRs load and check clean', () => {
  const storeDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus', 'decisions');
  const { adrs, fileErrors } = loadCorpus(storeDir);
  assert.deepEqual(fileErrors, [], `shape errors: ${JSON.stringify(fileErrors)}`);
  assert.ok(adrs.length >= 8, `expected the seed set, got ${adrs.length}`);
  const problems = checkCorpus(adrs);
  assert.deepEqual(problems, [], `cross-entry problems: ${JSON.stringify(problems)}`);
});
