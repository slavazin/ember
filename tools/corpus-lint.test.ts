import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { lint, rel, CONSTITUTION_ARTICLE_CAP, CONSTITUTION_SKILL, type Finding } from './corpus-lint.ts';
import { markers, parseEntry, renderIndexBlock, spliceIndexBlock } from './index-contract.ts';

// ── fixtures ──

// Write a map of repo-relative path -> content into a fresh temp dir, run fn(root),
// then clean up. Rules take the root explicitly, so they scan the fixture, not the repo.
function withCorpus(files: Record<string, string>, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'corpus-lint-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function errors(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === 'error');
}
function warnings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === 'warn');
}
function run(root: string, rule: string): Finding[] {
  return lint({ root, baseRef: 'main' }, [rule]).findings;
}

// Minimal valid entries, reused and mutated per test.
const DECISION = `---
id: D-0007
status: active
recurrences:
  - gateway: S-003
  - worker: S-005
moot-when: the datastore client is removed
created: 2026-08-20
---

# timeout storms upstream of a datastore stay pool-shaped until saturation is excluded

## Decision
Trace pool saturation before upstream causes.

## Warrant
- False if: the storm reproduces below 50% pool saturation (2026-08-20, S-003).

## Revisit
- {when: the pool autoscales, then: re-open, settled: }
`;

const RULE = `---
id: R-0004
status: active
fires-when: diagnosing latency or timeouts in a service with a datastore client
not-this:
warrant:
  - D-0003
  - D-0007
floor: none
residue: gate checks the report section exists, not that metrics were read
moot-when: the datastore client is removed
---

# check pool saturation before tracing upstream

## Duty
Diagnosing a datastore-client timeout → check pool saturation before upstream causes.
`;

const BELIEF = `---
id: B-0001
status: live
consult-when: estimating datastore burst capacity
verdict:
deadline: 2026-09-01
postdiction: false
created: 2026-08-20
reference:
  class: base-rate
  price: {value: 10, source: docs, as-of: 2026-08-01}
---

# a priced belief about burst capacity

## Claim
The datastore sustains 50 concurrent connections.

## Falsifier
- manual: a human checks the connection ceiling at the next incident.
`;

// A build ADR (tenant-build's self-describing store — its own ADR contract, not the layer's
// D- contract). Paired with a SCHEMA.md marker so discovery treats the store as self-describing.
const ADR = `---
id: ADR-0001
status: accepted
scopes: [tools/]
related: []
decided: 2026-08-28
---

# the corpus tooling runs directly under tsx with no build step

## Context
The layer tooling is TypeScript read by the same repository that hosts the corpus.

## Decision
The tooling runs directly under tsx; the checked-in source is the only artifact.

## Consequences
Enables editing a tool and re-running it in one step.

## Warrant
- False if: a runtime the corpus must support cannot execute TypeScript through a loader.
`;

// The two standing files that make tenant-build/corpus/decisions a self-describing store.
const ADR_STORE_STANDING = {
  'tenant-build/corpus/decisions/README.md': '# build ADR store\n\n**Kind:** ledger\n',
  'tenant-build/corpus/decisions/SCHEMA.md': '# SCHEMA — build ADR entry\n',
};

// ── R1 index-current ──

function emptyShell(store: 'decisions' | 'rules' | 'beliefs'): string {
  const shell = ['# read protocol prose', '', markers(store).begin, markers(store).end, '', 'more prose', ''].join('\n');
  return spliceIndexBlock(shell, store, renderIndexBlock(store, []));
}

function currentShell(store: 'decisions' | 'rules' | 'beliefs', entryText: string): string {
  const rec = parseEntry(store, entryText);
  const shell = ['# read protocol prose', '', markers(store).begin, markers(store).end, '', 'more prose', ''].join('\n');
  return spliceIndexBlock(shell, store, renderIndexBlock(store, [rec]));
}

// All three hosts, so only the store under test carries content and the others are
// empty-but-current (skills/ exists, so an absent host would itself be a failure).
function hosts(overrides: Partial<Record<'decisions' | 'rules' | 'beliefs', string>>): Record<string, string> {
  return {
    'skills/cases/SKILL.md': overrides.decisions ?? emptyShell('decisions'),
    'skills/rules/SKILL.md': overrides.rules ?? emptyShell('rules'),
    'skills/beliefs/SKILL.md': overrides.beliefs ?? emptyShell('beliefs'),
  };
}

test('index-current: a current region passes', () => {
  withCorpus(
    {
      'corpus/decisions/D-0007.md': DECISION,
      'corpus/decisions/README.md': '# r',
      'corpus/decisions/SCHEMA.md': '# s',
      ...hosts({ decisions: currentShell('decisions', DECISION) }),
    },
    (root) => assert.equal(errors(run(root, 'index-current')).length, 0),
  );
});

test('index-current: a stale region fails', () => {
  const staleShell = ['x', markers('decisions').begin, '- D-9999 · active · wrong', markers('decisions').end, ''].join('\n');
  withCorpus(
    { 'corpus/decisions/D-0007.md': DECISION, ...hosts({ decisions: staleShell }) },
    (root) => {
      const e = errors(run(root, 'index-current'));
      assert.equal(e.length, 1);
      assert.match(e[0]!.message, /stale/);
    },
  );
});

test('index-current: missing markers in an existing host fail (not a silent skip)', () => {
  withCorpus(
    { 'corpus/decisions/D-0007.md': DECISION, 'skills/cases/SKILL.md': '# no markers here' },
    (root) => assert.match(errors(run(root, 'index-current'))[0]!.message, /missing or malformed/),
  );
});

test('index-current: absent host is a skip while skills/ does not exist, a failure once it does', () => {
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION }, (root) => {
    // no skills/ dir at all -> skip
    const res = lint({ root }, ['index-current']);
    assert.equal(errors(res.findings).length, 0);
    assert.ok(res.skips.length >= 1);
  });
  withCorpus(
    { 'corpus/decisions/D-0007.md': DECISION, 'skills/rules/SKILL.md': currentShell('rules', RULE) },
    (root) => {
      // skills/ exists (rules host present) but cases/beliefs hosts absent -> errors
      const e = errors(run(root, 'index-current'));
      assert.ok(e.some((f) => /index host missing/.test(f.message)));
    },
  );
});

test('index-current: an admitted entry that does not parse is reported, not crashed', () => {
  const noId = DECISION.replace('id: D-0007\n', '');
  withCorpus(
    { 'corpus/decisions/D-0007.md': noId, 'skills/cases/SKILL.md': currentShell('decisions', DECISION) },
    (root) => assert.match(errors(run(root, 'index-current'))[0]!.message, /does not parse/),
  );
});

// ── R2 five-slot ──

test('five-slot: valid decision, rule, belief all pass', () => {
  withCorpus(
    {
      'corpus/decisions/D-0007.md': DECISION,
      'corpus/rules/R-0004.md': RULE,
      'corpus/beliefs/B-0001.md': BELIEF,
    },
    (root) => assert.equal(errors(run(root, 'five-slot')).length, 0),
  );
});

test('five-slot: id must match its canonical filename; a draft is exempt', () => {
  // D-0008.md carrying id D-0007 — index keys on the id, frozen-path on the filename
  withCorpus({ 'corpus/decisions/D-0008.md': DECISION }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /match its id/.test(f.message))),
  );
  // a non-canonical id shape is flagged
  withCorpus({ 'corpus/decisions/D-7.md': DECISION.replace('id: D-0007', 'id: D-7') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /not a canonical/.test(f.message))),
  );
  // a draft (no id) at a slug name is exempt from the identity check
  withCorpus({ 'corpus/decisions/new-decision.md': DECISION.replace('id: D-0007\n', '') }, (root) =>
    assert.ok(!errors(run(root, 'five-slot')).some((f) => /(match its id|not a canonical)/.test(f.message))),
  );
});

test('five-slot: a decision missing ## Warrant fails', () => {
  withCorpus(
    { 'corpus/decisions/D-0007.md': DECISION.replace('## Warrant', '## Warranty-typo') },
    (root) => assert.match(errors(run(root, 'five-slot'))[0]!.message, /## Warrant/),
  );
});

test('five-slot: admitted decision with <2 recurrences fails; a draft does not', () => {
  const oneRec = DECISION.replace('  - worker: S-005\n', '');
  withCorpus({ 'corpus/decisions/D-0007.md': oneRec }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /recurrences/.test(f.message))),
  );
  // draft: no id -> admission-bar recurrences check does not apply
  const draft = oneRec.replace('id: D-0007\n', '');
  withCorpus({ 'corpus/decisions/new-decision.md': draft }, (root) =>
    assert.ok(!errors(run(root, 'five-slot')).some((f) => /recurrences/.test(f.message))),
  );
});

test('five-slot: rule with empty not-this passes (young rule is honest), absent key fails', () => {
  withCorpus({ 'corpus/rules/R-0004.md': RULE }, (root) =>
    assert.ok(!errors(run(root, 'five-slot')).some((f) => /not-this/.test(f.message))),
  );
  const noKey = RULE.replace('not-this:\n', '');
  withCorpus({ 'corpus/rules/R-0004.md': noKey }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /not-this/.test(f.message))),
  );
});

test('five-slot: rule warrant must be ≥2 decision IDs (D-nnnn), not other prefixes', () => {
  const badWarrant = RULE.replace('  - D-0003\n  - D-0007\n', '  - R-0001\n  - B-0002\n');
  withCorpus({ 'corpus/rules/R-0004.md': badWarrant }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /warrant/.test(f.message))),
  );
  const oneWarrant = RULE.replace('  - D-0007\n', '');
  withCorpus({ 'corpus/rules/R-0004.md': oneWarrant }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /warrant/.test(f.message))),
  );
});

test('five-slot: belief missing ## Falsifier, missing reference, or a draft verdict all fail', () => {
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF.replace('## Falsifier', '## Nope') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /## Falsifier/.test(f.message))),
  );
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF.replace(/reference:\n(  .*\n)+/, '') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /reference/.test(f.message))),
  );
  // draft (no id) with a filled verdict
  const draftVerdict = BELIEF.replace('id: B-0001\n', '').replace('verdict:', 'verdict: holds');
  withCorpus({ 'corpus/beliefs/draft-belief.md': draftVerdict }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /verdict/.test(f.message))),
  );
});

// ── R2b tombstone ──

test('tombstone: superseded needs a successor; a pointer needs superseded status', () => {
  const supersededOk = DECISION.replace('status: active', 'status: superseded\nsuperseded-by: D-0009');
  withCorpus({ 'corpus/decisions/D-0007.md': supersededOk }, (root) => assert.equal(errors(run(root, 'tombstone')).length, 0));

  const supersededNoPtr = DECISION.replace('status: active', 'status: superseded');
  withCorpus({ 'corpus/decisions/D-0007.md': supersededNoPtr }, (root) =>
    assert.match(errors(run(root, 'tombstone'))[0]!.message, /requires a 'superseded-by'/),
  );

  const ptrNoStatus = DECISION.replace('status: active', 'status: active\nsuperseded-by: D-0009');
  withCorpus({ 'corpus/decisions/D-0007.md': ptrNoStatus }, (root) =>
    assert.match(errors(run(root, 'tombstone'))[0]!.message, /not 'superseded'/),
  );
});

// ── R3 constitution-cap ──

function articles(n: number): string {
  let out = '# Constitution skill\n\n';
  for (let i = 1; i <= n; i++) out += `**Article ${i} — title.** body.\n\n`;
  return out;
}

// The heading form Track C actually authors (`## Article N — Title.`).
function articleHeadings(n: number): string {
  let out = '---\nname: constitution\n---\n\n# The constitution\n\n';
  for (let i = 1; i <= n; i++) out += `## Article ${i} — title.\nbody.\n\n`;
  return out;
}

test('constitution-cap: at the cap passes, over the cap fails, cross-refs do not inflate', () => {
  withCorpus({ [CONSTITUTION_SKILL]: articles(CONSTITUTION_ARTICLE_CAP) + '\nsee Article 3 for detail\n' }, (root) =>
    assert.equal(errors(run(root, 'constitution-cap')).length, 0),
  );
  withCorpus({ [CONSTITUTION_SKILL]: articles(CONSTITUTION_ARTICLE_CAP + 1) }, (root) =>
    assert.match(errors(run(root, 'constitution-cap'))[0]!.message, /exceeds the cap/),
  );
});

test('constitution-cap: counts the ## Article N heading form (Track C authors this) too', () => {
  withCorpus({ [CONSTITUTION_SKILL]: articleHeadings(9) }, (root) => assert.equal(errors(run(root, 'constitution-cap')).length, 0));
  withCorpus({ [CONSTITUTION_SKILL]: articleHeadings(CONSTITUTION_ARTICLE_CAP + 1) }, (root) =>
    assert.match(errors(run(root, 'constitution-cap'))[0]!.message, /exceeds the cap/),
  );
});

test('constitution-cap: absent skill is a disclosed skip', () => {
  withCorpus({ 'corpus/decisions/README.md': '# r' }, (root) => {
    const res = lint({ root }, ['constitution-cap']);
    assert.equal(res.findings.length, 0);
    assert.equal(res.skips.length, 1);
  });
});

// ── R4 frozen-path (temp git repo) ──

function withGitRepo(base: Record<string, string>, mutate: (root: string) => void, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'corpus-lint-git-'));
  const g = (args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    g(['init', '-q']);
    g(['config', 'user.email', 'test@example.com']);
    g(['config', 'user.name', 'test']);
    g(['config', 'commit.gpgsign', 'false']);
    for (const [rel, content] of Object.entries(base)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    g(['add', '-A']);
    g(['commit', '-qm', 'base']);
    g(['branch', '-M', 'main']);
    mutate(root);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('frozen-path: an untouched ledger entry passes', () => {
  withGitRepo({ 'corpus/decisions/D-0001.md': DECISION }, () => {}, (root) =>
    assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
});

test('frozen-path: a body edit fails', () => {
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    (root) => writeFileSync(join(root, 'corpus/decisions/D-0001.md'), DECISION.replace('Trace pool saturation', 'Trace something else')),
    (root) => assert.match(errors(run(root, 'frozen-path'))[0]!.message, /frozen body/),
  );
});

test('frozen-path: a frozen frontmatter edit fails, a sanctioned status flip passes', () => {
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    (root) => writeFileSync(join(root, 'corpus/decisions/D-0001.md'), DECISION.replace('created: 2026-08-20', 'created: 2026-08-21')),
    (root) => assert.match(errors(run(root, 'frozen-path'))[0]!.message, /frozen frontmatter/),
  );
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    (root) => writeFileSync(join(root, 'corpus/decisions/D-0001.md'), DECISION.replace('status: active', 'status: superseded\nsuperseded-by: D-0009')),
    (root) => assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
});

test('frozen-path: a belief verdict fill is sanctioned', () => {
  withGitRepo(
    { 'corpus/beliefs/B-0001.md': BELIEF },
    (root) => writeFileSync(join(root, 'corpus/beliefs/B-0001.md'), BELIEF.replace('verdict:', 'verdict: rebutted').replace('status: live', 'status: settled')),
    (root) => assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
});

test('frozen-path: deleting or renaming a frozen entry fails', () => {
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    (root) => rmSync(join(root, 'corpus/decisions/D-0001.md')),
    (root) => assert.match(errors(run(root, 'frozen-path'))[0]!.message, /deleted or renamed/),
  );
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    (root) => {
      rmSync(join(root, 'corpus/decisions/D-0001.md'));
      writeFileSync(join(root, 'corpus/decisions/D-0001-old.md'), DECISION);
    },
    (root) => assert.ok(errors(run(root, 'frozen-path')).some((f) => /deleted or renamed/.test(f.message))),
  );
});

test('frozen-path: a register store (rules) is exempt — corrected in place', () => {
  withGitRepo(
    { 'corpus/rules/R-0001.md': RULE },
    (root) => writeFileSync(join(root, 'corpus/rules/R-0001.md'), RULE.replace('floor: none', 'floor: a-new-gate')),
    (root) => assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
});

test('frozen-path: an unresolvable base ref is a loud skip, not a false pass', () => {
  withGitRepo({ 'corpus/decisions/D-0001.md': DECISION }, () => {}, (root) => {
    const res = lint({ root, baseRef: 'no-such-ref' }, ['frozen-path']);
    assert.equal(res.findings.length, 0);
    assert.equal(res.skips.length, 1);
    assert.match(res.skips[0]!.reason, /UNCHECKED/);
  });
});

// ── build ADR store wiring (Part A: tenant-build/) ──

const ADR_BASE = { ...ADR_STORE_STANDING, 'tenant-build/corpus/decisions/ADR-0001.md': ADR };

test('frozen-path: the build ADR store is frozen on ITS OWN contract — a body edit fails', () => {
  withGitRepo(
    ADR_BASE,
    (root) => writeFileSync(join(root, 'tenant-build/corpus/decisions/ADR-0001.md'), ADR.replace('runs directly under tsx; the', 'runs some other way; the')),
    (root) => {
      const errs = errors(run(root, 'frozen-path'));
      assert.ok(errs.some((f) => f.file === 'tenant-build/corpus/decisions/ADR-0001.md' && /frozen body/.test(f.message)), JSON.stringify(errs));
    },
  );
});

test('frozen-path: an ADR status flip to superseded is sanctioned; a frozen field edit fails', () => {
  withGitRepo(
    ADR_BASE,
    (root) => writeFileSync(join(root, 'tenant-build/corpus/decisions/ADR-0001.md'), ADR.replace('status: accepted', 'status: superseded\nsuperseded-by: ADR-0009')),
    (root) => assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
  withGitRepo(
    ADR_BASE,
    (root) => writeFileSync(join(root, 'tenant-build/corpus/decisions/ADR-0001.md'), ADR.replace('decided: 2026-08-28', 'decided: 2026-08-29')),
    (root) => assert.match(errors(run(root, 'frozen-path'))[0]!.message, /frozen frontmatter/),
  );
});

test('frozen-path: an ADR convergence (multiline converged-into list) is sanctioned', () => {
  // converged-into is a list mutable key: its indented items must be droppable, or a legitimate
  // convergence would read as a frozen-frontmatter edit (the block-aware mutable filter).
  withGitRepo(
    ADR_BASE,
    (root) =>
      writeFileSync(
        join(root, 'tenant-build/corpus/decisions/ADR-0001.md'),
        ADR.replace('status: accepted', 'status: converged\nconverged-into:\n  - ADR-0009'),
      ),
    (root) => assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
});

test('decision 4: a self-describing tenant store (own SCHEMA) is NOT held to the layer entry contract', () => {
  // ADR-0001.md would fail the layer decisions five-slot (no D- id, no ## Revisit, no recurrences).
  // Because tenant-build ships its own SCHEMA, discovery excludes it from the layer entry checks —
  // its own `adr check` owns it. Forcing the layer contract onto it is the BS-0012 mistake.
  withCorpus({ ...ADR_BASE }, (root) => {
    const relevant = errors(run(root, 'five-slot')).filter((f) => f.file.startsWith('tenant-build/'));
    assert.deepEqual(relevant, [], JSON.stringify(relevant));
  });
});

test('banned-tell: extends to the build ADR store and tenant-incident prose, but not fixtures', () => {
  withCorpus(
    {
      'tenant-build/corpus/decisions/ADR-0001.md': ADR.replace('## Context', '## Context\nWe decided to trace it.'),
      'tenant-incident/scenarios/x/README.md': 'The pool saturates for now.\n',
      'tenant-incident/scenarios/x/fixtures/report.md': 'We decided this at the moment.\n', // a fixture — excluded
    },
    (root) => {
      const errs = errors(run(root, 'banned-tell'));
      assert.ok(errs.some((f) => f.file === 'tenant-build/corpus/decisions/ADR-0001.md'), 'ADR prose scanned');
      assert.ok(errs.some((f) => f.file === 'tenant-incident/scenarios/x/README.md'), 'tenant prose scanned');
      assert.ok(!errs.some((f) => f.file.includes('/fixtures/')), 'fixtures excluded: ' + JSON.stringify(errs));
    },
  );
});

test('check-seam: tenant-build is exempt — its files are not layer, and it seeds no tenant vocabulary', () => {
  withCorpus(
    {
      // a derivable tenant term (scenario base name)
      'tenant-incident/scenarios/pool-exhaustion-a/x.txt': '',
      // tenant-build legitimately names the tenant term (its subject includes the tenant surface) and a layer term
      'tenant-build/corpus/decisions/ADR-0001.md': ADR.replace('## Context', '## Context\nGoverns pool-exhaustion handling and corpus-lint.'),
      ...ADR_STORE_STANDING,
      // a real layer file naming the same tenant term IS a leak
      'tools/leak.md': 'the pool-exhaustion class is handled here',
    },
    (root) => {
      const errs = errors(run(root, 'check-seam'));
      assert.ok(!errs.some((f) => f.file.startsWith('tenant-build/')), 'tenant-build must not be scanned as a layer file: ' + JSON.stringify(errs));
      assert.ok(errs.some((f) => f.file === 'tools/leak.md'), 'a genuine layer leak must still fire');
    },
  );
});

// Qodo #11 (cross-root ambiguity): multi-root discovery must enforce id uniqueness across the
// whole discovered set, not per directory — the same id under two roots is an ambiguous record.
test('unique-id: the same canonical id under two roots is flagged, naming every path', () => {
  withCorpus(
    {
      'corpus/decisions/D-0001.md': DECISION.replace('id: D-0007', 'id: D-0001'),
      'tenant-incident/corpus/decisions/D-0001.md': DECISION.replace('id: D-0007', 'id: D-0001'),
    },
    (root) => {
      const errs = errors(run(root, 'unique-id'));
      assert.equal(errs.length, 2, JSON.stringify(errs));
      assert.ok(errs.every((f) => /claimed by 2 entries across corpus roots/.test(f.message)));
    },
  );
});

test('unique-id: distinct ids across roots pass', () => {
  withCorpus(
    {
      'corpus/decisions/D-0001.md': DECISION.replace('id: D-0007', 'id: D-0001'),
      'tenant-incident/corpus/decisions/D-0002.md': DECISION.replace('id: D-0007', 'id: D-0002'),
    },
    (root) => assert.equal(errors(run(root, 'unique-id')).length, 0),
  );
});

// Qodo #11 (deleted stores evade freeze): the frozen pathspec is derived from base∪working-tree,
// so deleting a store directory cannot remove it from the base comparison. Previously the pathspec
// came from working-tree discovery alone, so a deletion shrank the gate's own scope.
test('frozen-path: deleting an entire ledger store directory is still caught', () => {
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    (root) => rmSync(join(root, 'corpus/decisions'), { recursive: true, force: true }),
    (root) => assert.ok(errors(run(root, 'frozen-path')).some((f) => f.file === 'corpus/decisions/D-0001.md' && /deleted or renamed/.test(f.message))),
  );
});

test('frozen-path: deleting the build ADR store tree is caught (base-derived pathspec)', () => {
  withGitRepo(
    { ...ADR_STORE_STANDING, 'tenant-build/corpus/decisions/ADR-0001.md': ADR },
    (root) => rmSync(join(root, 'tenant-build'), { recursive: true, force: true }),
    (root) => assert.ok(errors(run(root, 'frozen-path')).some((f) => f.file === 'tenant-build/corpus/decisions/ADR-0001.md' && /deleted or renamed/.test(f.message))),
  );
});

test('frozen-path: an ADR convergence with an indentationless converged-into list is sanctioned', () => {
  // js-yaml accepts a sequence directly under a mapping key with no extra indentation; the
  // mutable-key stripper must recognize that form too, or a valid convergence reads as a frozen edit.
  withGitRepo(
    ADR_BASE,
    (root) =>
      writeFileSync(
        join(root, 'tenant-build/corpus/decisions/ADR-0001.md'),
        ADR.replace('status: accepted', 'status: converged\nconverged-into:\n- ADR-0009'),
      ),
    (root) => assert.equal(errors(run(root, 'frozen-path')).length, 0),
  );
});

// ── R5 no-duty-language ──

test('no-duty-language: fires-when in a decision fails; a clean decision passes', () => {
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION }, (root) => assert.equal(errors(run(root, 'no-duty-language')).length, 0));
  const withDuty = DECISION.replace('## Decision\n', '## Decision\nfires-when: something\n');
  withCorpus({ 'corpus/decisions/D-0007.md': withDuty }, (root) =>
    assert.match(errors(run(root, 'no-duty-language'))[0]!.message, /fires-when/),
  );
});

// ── R6 banned-tell ──

test('banned-tell: phrases are errors, common words are warnings, I/O is not flagged', () => {
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('## Decision\n', '## Decision\nwe decided to trace.\n') }, (root) => {
    assert.ok(errors(run(root, 'banned-tell')).some((f) => /we decided/.test(f.message)));
  });
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('## Decision\n', '## Decision\nthe new approach.\n') }, (root) => {
    const f = run(root, 'banned-tell');
    assert.equal(errors(f).length, 0);
    assert.ok(warnings(f).some((w) => /'new'/.test(w.message)));
  });
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('## Decision\n', '## Decision\ncheck disk I/O pressure.\n') }, (root) => {
    assert.equal(run(root, 'banned-tell').length, 0);
  });
});

test('banned-tell: LANGUAGE.md excluded surgically — tables and quotes skipped, prose still scanned', () => {
  // tells inside its L1 table row and its quoted example are not flagged
  withCorpus({ 'corpus/LANGUAGE.md': '| this session, we, I | delete |\nHe wrote "we decided" as the example.\n' }, (root) =>
    assert.equal(run(root, 'banned-tell').length, 0),
  );
  // a hard tell in its bare prose IS caught — a principled exclusion, not a blanket skip
  withCorpus({ 'corpus/LANGUAGE.md': 'we decided to change the schema.' }, (root) =>
    assert.ok(errors(run(root, 'banned-tell')).some((f) => /we decided/.test(f.message))),
  );
  // common-word advisories are not run against the file that defines those words
  withCorpus({ 'corpus/LANGUAGE.md': 'New terms enter through the escape.' }, (root) =>
    assert.equal(run(root, 'banned-tell').length, 0),
  );
});

test('banned-tell: code spans are stripped so a quoted tell in an example is not flagged', () => {
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('## Decision\n', '## Decision\n`we decided` is a tell.\n') }, (root) =>
    assert.equal(errors(run(root, 'banned-tell')).length, 0),
  );
});

// ── R7 date-format ──

test('date-format: slash, month-name, and unpadded ISO fail; padded ISO and placeholders pass', () => {
  const cases: Array<[string, boolean]> = [
    ['deadline 08/27/2026 here', true],
    ['on Aug 27 it happened', true],
    ['as of 2026-8-1 here', true],
    ['as of 2026-08-01 here', false],
    ['use YYYY-MM-DD here', false],
  ];
  for (const [snippet, shouldFail] of cases) {
    withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('## Decision\n', `## Decision\n${snippet}\n`) }, (root) => {
      const e = errors(run(root, 'date-format'));
      assert.equal(e.length > 0, shouldFail, `"${snippet}" expected fail=${shouldFail}, got ${e.length}`);
    });
  }
});

// ── R8 do-dont ──

const SCHEMA_PAIRED = `# SCHEMA\n\n**Do:** thing.\n**Don't:** counter.\n\n**Do:** other.\n**Don't:** its counter.\n`;

test('do-dont: paired SCHEMA passes; a lone Do fails; internal-colon form is recognized', () => {
  withCorpus({ 'corpus/x/README.md': '# r', 'corpus/x/SCHEMA.md': SCHEMA_PAIRED }, (root) => assert.equal(errors(run(root, 'do-dont')).length, 0));
  withCorpus({ 'corpus/x/README.md': '# r', 'corpus/x/SCHEMA.md': "# S\n\n**Do:** lonely.\n" }, (root) =>
    assert.ok(errors(run(root, 'do-dont')).length > 0),
  );
  withCorpus({ 'corpus/x/README.md': '# r', 'corpus/x/SCHEMA.md': "# S\n\n**Do: key on presentation.**\n**Don't: reduce to surface.**\n" }, (root) =>
    assert.equal(errors(run(root, 'do-dont')).length, 0),
  );
});

test('do-dont: skill packs and role templates are checked; bold **Do not** is not a Do', () => {
  // LANGUAGE.md L3 mandates the pair in skill packs and role templates too.
  withCorpus({ 'skills/session/SKILL.md': SCHEMA_PAIRED, 'roles/recon.md': SCHEMA_PAIRED }, (root) => assert.equal(errors(run(root, 'do-dont')).length, 0));
  withCorpus({ 'skills/session/SKILL.md': "# S\n\n**Do:** paired.\n**Don't:** ok.\n\n**Do:** lonely.\n" }, (root) =>
    assert.ok(errors(run(root, 'do-dont')).length > 0),
  );
  // emphasis, not a directive pair — must not be miscounted as an unpaired Do
  withCorpus({ 'skills/session/SKILL.md': '# S\n\nYou **Do not** get a second gate.\n' }, (root) =>
    assert.equal(errors(run(root, 'do-dont')).length, 0),
  );
});

// ── R9 readme-kind ──

test('readme-kind: a Kind declaration passes; its absence fails', () => {
  withCorpus({ 'corpus/x/README.md': '# x\n\n**Kind:** ledger.\n', 'corpus/x/SCHEMA.md': '# s' }, (root) => assert.equal(errors(run(root, 'readme-kind')).length, 0));
  withCorpus({ 'corpus/x/README.md': '# x\n\nno kind here\n', 'corpus/x/SCHEMA.md': '# s' }, (root) =>
    assert.match(errors(run(root, 'readme-kind'))[0]!.message, /Kind/),
  );
});

// ── R10 escapes ──

test('escapes: well-formed other(<what>) passes; empty, unclosed, and lookalikes handled', () => {
  withCorpus({ 'corpus/beliefs/B-0001.md': 'class: other(persistence gap)\n' }, (root) => assert.equal(errors(run(root, 'escapes')).length, 0));
  withCorpus({ 'corpus/beliefs/B-0001.md': 'class: other()\n' }, (root) => assert.match(errors(run(root, 'escapes'))[0]!.message, /empty escape/));
  withCorpus({ 'corpus/beliefs/B-0001.md': 'class: other(\n' }, (root) => assert.match(errors(run(root, 'escapes'))[0]!.message, /unclosed/));
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('## Decision\n', '## Decision\nanother(thing) is fine.\n') }, (root) =>
    assert.equal(errors(run(root, 'escapes')).length, 0),
  );
});

// ── R11 check-seam ──

test('check-seam: a scenario name in a layer file leaks; the same in an index region does not', () => {
  withCorpus(
    { 'scenarios/pool-exhaustion-a/x.txt': '', 'skills/foo/SKILL.md': 'This layer skill mentions pool-exhaustion directly.' },
    (root) => assert.match(errors(run(root, 'check-seam'))[0]!.message, /tenant term 'pool-exhaustion'/),
  );
  // the derived tenant summary inside the generated index region is exempt
  const shell = [markers('decisions').begin, '- D-1 · active · a pool-exhaustion case summary', markers('decisions').end, ''].join('\n');
  withCorpus({ 'scenarios/pool-exhaustion-a/x.txt': '', 'skills/cases/SKILL.md': shell }, (root) =>
    assert.equal(errors(run(root, 'check-seam')).length, 0),
  );
});

test('check-seam: a vocabulary term header leaks into a layer file', () => {
  withCorpus(
    { 'corpus/vocabulary/terms.md': '## widget-fault\n- **means:** x\n', 'roles/recon.md': 'investigate the widget-fault shape' },
    (root) => assert.ok(errors(run(root, 'check-seam')).some((f) => /widget-fault/.test(f.message))),
  );
});

test('check-seam: no derivable tenant vocabulary is a disclosed no-op skip', () => {
  withCorpus({ 'skills/foo/SKILL.md': 'clean layer prose' }, (root) => {
    const res = lint({ root }, ['check-seam']);
    assert.equal(res.findings.length, 0);
    assert.equal(res.skips.length, 1);
  });
});

test('check-seam: a tenant term in a *.test.ts fixture is exempt; in production code it leaks', () => {
  // A seam test must name tenant terms as fixtures — the scan must not flag the suite itself.
  withCorpus(
    { 'scenarios/pool-exhaustion-a/x.txt': '', 'tools/thing.test.ts': 'a fixture that mentions pool-exhaustion' },
    (root) => assert.equal(errors(run(root, 'check-seam')).length, 0),
  );
  // The same term in shipped layer code is still a leak.
  withCorpus(
    { 'scenarios/pool-exhaustion-a/x.txt': '', 'tools/thing.ts': 'code that mentions pool-exhaustion' },
    (root) => assert.match(errors(run(root, 'check-seam'))[0]!.message, /tenant term 'pool-exhaustion'/),
  );
});

// ── locks for the Qodo review findings (presence/shape hardening) ──

test('five-slot: required lifecycle/hook fields must be present; status must be a valid enum', () => {
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('status: active\n', '') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /'status'/.test(f.message))),
  );
  withCorpus({ 'corpus/decisions/D-0007.md': DECISION.replace('status: active', 'status: nonsense') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /must be one of/.test(f.message))),
  );
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF.replace('consult-when: estimating datastore burst capacity\n', '') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /consult-when/.test(f.message))),
  );
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF.replace('postdiction: false\n', '') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /postdiction/.test(f.message))),
  );
});

test('five-slot: recurrences must be ≥2 anchored maps, not bare strings', () => {
  const bad = DECISION.replace(/recurrences:\n(  - .*\n)+/, 'recurrences: [foo, bar]\n');
  withCorpus({ 'corpus/decisions/D-0007.md': bad }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /recurrences/.test(f.message))),
  );
});

test('five-slot: a belief reference needs a non-empty class plus price or categorical', () => {
  const emptyClass = BELIEF.replace(/reference:\n(  .*\n)+/, 'reference:\n  class:\n  price: {value: 1, source: x, as-of: 2026-08-01}\n');
  withCorpus({ 'corpus/beliefs/B-0001.md': emptyClass }, (root) => assert.ok(errors(run(root, 'five-slot')).some((f) => /reference/.test(f.message))));
  const noPrice = BELIEF.replace(/reference:\n(  .*\n)+/, 'reference:\n  class: base-rate\n');
  withCorpus({ 'corpus/beliefs/B-0001.md': noPrice }, (root) => assert.ok(errors(run(root, 'five-slot')).some((f) => /reference/.test(f.message))));
  // a categorical reference (no price map) is accepted
  const categorical = BELIEF.replace(/reference:\n(  .*\n)+/, 'reference:\n  class: incumbent\n  categorical: unchanged\n');
  withCorpus({ 'corpus/beliefs/B-0001.md': categorical }, (root) => assert.equal(errors(run(root, 'five-slot')).length, 0));
});

test('five-slot: a recurrence with an empty surface key is rejected', () => {
  const bad = DECISION.replace(/recurrences:\n(  - .*\n)+/, "recurrences:\n  - '': S-003\n  - worker: S-005\n");
  withCorpus({ 'corpus/decisions/D-0007.md': bad }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /recurrences/.test(f.message))),
  );
});

test('five-slot: postdiction must be a boolean, not arbitrary text', () => {
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF.replace('postdiction: false', 'postdiction: nonsense') }, (root) =>
    assert.ok(errors(run(root, 'five-slot')).some((f) => /postdiction.*must be one of/.test(f.message))),
  );
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF.replace('postdiction: false', 'postdiction: true') }, (root) =>
    assert.ok(!errors(run(root, 'five-slot')).some((f) => /postdiction/.test(f.message))),
  );
});

test('five-slot: a belief reference must be a proper price map or scalar categorical', () => {
  for (const c of ['price: [foo]', 'price: {foo: bar}', 'categorical: {x: y}']) {
    const bad = BELIEF.replace(/reference:\n(  .*\n)+/, `reference:\n  class: base-rate\n  ${c}\n`);
    withCorpus({ 'corpus/beliefs/B-0001.md': bad }, (root) =>
      assert.ok(errors(run(root, 'five-slot')).some((f) => /reference/.test(f.message)), `expected a reference finding for "${c}"`),
    );
  }
  withCorpus({ 'corpus/beliefs/B-0001.md': BELIEF }, (root) => assert.equal(errors(run(root, 'five-slot')).length, 0));
});

test('check-seam: a fake index-marker region only exempts the store\'s own host, not other layer files', () => {
  const fake = [markers('decisions').begin, 'this role secretly mentions pool-exhaustion', markers('decisions').end, ''].join('\n');
  withCorpus({ 'scenarios/pool-exhaustion-a/x.txt': '', 'roles/recon.md': fake }, (root) =>
    assert.ok(errors(run(root, 'check-seam')).some((f) => /pool-exhaustion/.test(f.message))),
  );
});

test('escapes: an unclosed other( does not borrow a closing paren from a later line', () => {
  const body = DECISION.replace('## Decision\n', '## Decision\nsee other(foo here\nand later a paren) elsewhere\n');
  withCorpus({ 'corpus/decisions/D-0007.md': body }, (root) =>
    assert.ok(errors(run(root, 'escapes')).some((f) => /unclosed/.test(f.message))),
  );
});

test('constitution-cap: bare-prose "Article N" is not counted, only marked headings', () => {
  const body = articleHeadings(CONSTITUTION_ARTICLE_CAP) + '\nArticle 11 is discussed below in prose.\n';
  withCorpus({ [CONSTITUTION_SKILL]: body }, (root) => assert.equal(errors(run(root, 'constitution-cap')).length, 0));
});

test('do-dont: a Do and Don\'t split by a blank line are not a valid pair', () => {
  withCorpus({ 'corpus/x/README.md': '# r', 'corpus/x/SCHEMA.md': "# S\n\n**Do:** near.\n\n**Don't:** far, across a blank line.\n" }, (root) =>
    assert.ok(errors(run(root, 'do-dont')).some((f) => /same block/.test(f.message))),
  );
});

// rel() must return a '/'-separated repo-relative path from either OS separator — a
// '/'-only strip left the root in place on Windows (join yields '\'), doubling the path
// and ENOENT-ing every file read. Locked here so the fix holds without the Windows CI leg
// (platform-assumption; the leg surfaced it, this test pins it on every platform).
test('rel: strips the root and normalizes separators (POSIX, Windows, and mixed)', () => {
  assert.equal(rel('/tmp/x', '/tmp/x/corpus/decisions/D-0007.md'), 'corpus/decisions/D-0007.md');
  assert.equal(rel('C:\\Temp\\x', 'C:\\Temp\\x\\corpus\\decisions\\D-0007.md'), 'corpus/decisions/D-0007.md');
  assert.equal(rel('C:/Users/x/ember', 'C:\\Users\\x\\ember\\corpus\\LANGUAGE.md'), 'corpus/LANGUAGE.md');
  assert.equal(rel('/tmp/x/', '/tmp/x/corpus/README.md'), 'corpus/README.md'); // trailing-slash root
});

// ── refs-resolve (BS-0010, dangling-reference) ──

test('refs-resolve: an absolute markdown link to a missing file is an error', () => {
  withCorpus({ 'skills/x/SKILL.md': '# x\n\nOpen [the tables](/corpus/latches/planning.md) first.\n' }, (root) =>
    assert.ok(errors(run(root, 'refs-resolve')).some((f) => /planning\.md/.test(f.message))),
  );
});

test('refs-resolve: a bare code-span layer path to a missing file is an error', () => {
  withCorpus({ 'skills/x/SKILL.md': '# x\n\nPoll each row of `corpus/latches/closing.md`.\n' }, (root) =>
    assert.ok(errors(run(root, 'refs-resolve')).some((f) => /closing\.md/.test(f.message))),
  );
});

test('refs-resolve: references that resolve pass', () => {
  withCorpus(
    {
      'skills/x/SKILL.md': '# x\n\nSee [readme](/corpus/README.md) then `corpus/latches/planning.md`.\n',
      'corpus/README.md': '# r\n',
      'corpus/latches/planning.md': '| fires-when | consult | owed act |\n',
    },
    (root) => assert.deepEqual(errors(run(root, 'refs-resolve')), []),
  );
});

test('refs-resolve: a reference to a tool protocol under tools/*.md is checked', () => {
  withCorpus({ 'tools/INDEX-CONTRACT.md': '# contract\n\nImports [the module](/tools/index-contract.ts).\n' }, (root) =>
    assert.ok(errors(run(root, 'refs-resolve')).some((f) => /index-contract\.ts/.test(f.message))),
  );
});

test('refs-resolve: a reference climbing out of the repo (..) is an error, not an environment probe', () => {
  withCorpus({ 'skills/x/SKILL.md': '# x\n\nSee [outside](/../secret.md) and `corpus/../etc/passwd.md`.\n' }, (root) => {
    const errs = errors(run(root, 'refs-resolve'));
    assert.ok(errs.some((f) => /escapes the repository/.test(f.message)), 'expected a repo-escape error');
    assert.equal(errs.length, 2, 'both traversal references flagged');
  });
});

test('refs-resolve: entry-file placeholders and fenced examples are exempt', () => {
  withCorpus(
    {
      // `…-nnnn.md` is a stand-in, not a file; the dangling link inside a fence is illustrative.
      'skills/x/SKILL.md': '# x\n\nName it `corpus/decisions/D-nnnn.md`.\n\n```\n[nope](/corpus/gone.md)\n```\n',
    },
    (root) => assert.deepEqual(errors(run(root, 'refs-resolve')), []),
  );
});

// ── the whole real repo is green today (locks the today-green guarantee) ──

test('the real repo passes with zero errors (only disclosed skips)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // fileURLToPath, not .pathname: on Windows .pathname is /C:/… and breaks path APIs
  if (!existsSync(join(root, 'corpus'))) return; // not running from the repo
  const { findings } = lint({ root });
  const errs = errors(findings);
  assert.equal(errs.length, 0, 'unexpected errors: ' + JSON.stringify(errs, null, 2));
});

// A scanner must never flag the code that defines or exercises the pattern it hunts — the
// self-match class (BS-0004 on LANGUAGE.md's tell tables, BS-0022 on a seam test's fixtures).
// Every rule walks the real repo here; a future rule that reaches into *.test.ts (where
// fixtures legitimately carry the patterns) trips this guard instead of the CI gate.
test('no rule flags a *.test.ts fixture surface (self-match class guard: BS-0004, BS-0022)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // fileURLToPath, not .pathname: on Windows .pathname is /C:/… and breaks path APIs
  if (!existsSync(join(root, 'corpus'))) return;
  const { findings } = lint({ root });
  const selfFlagged = findings.filter((f) => f.file.endsWith('.test.ts'));
  assert.deepEqual(selfFlagged, [], 'a scanner walked its own test surface: ' + JSON.stringify(selfFlagged));
});

// BS-0023 (self-referential-baseline): when the base resolves to HEAD and the working tree is
// clean, frozenPath would compare every frozen entry to itself and pass vacuously — the exact
// push-to-main exposure. It must disclose a skip instead. (A dirty working tree against
// base==HEAD is the normal local flow and still runs — the frozen-path edit tests above cover
// that path.) Tool-level backstop to CI pinning the pre-change base per event.
test('frozen-path: base==HEAD with a clean tree is a disclosed skip, not a vacuous pass (BS-0023)', () => {
  withGitRepo(
    { 'corpus/decisions/D-0001.md': DECISION },
    () => {}, // no mutation — the working tree matches HEAD, and base 'main' resolves to HEAD
    (root) => {
      const { findings, skips } = lint({ root, baseRef: 'main' }, ['frozen-path']);
      assert.deepEqual(errors(findings), [], 'frozen-path must not report errors when it cannot compare');
      assert.ok(
        skips.some((s) => s.rule === 'frozen-path' && /equals HEAD/.test(s.reason)),
        'expected a frozen-path self-compare skip',
      );
    },
  );
});
