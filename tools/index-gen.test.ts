import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { markers, INDEX_TARGETS, FIELD_SEP, type StoreId } from './index-contract.ts';
import { discoverEntryFiles, planStore, processStore, run } from './index-gen.ts';

const STORES: StoreId[] = ['decisions', 'rules', 'beliefs'];

// A host SKILL.md whose region is already empty-and-current: the two marker lines
// adjacent, with the read protocol prose kept OUTSIDE the region per the contract.
function currentEmptyShell(store: StoreId): string {
  const { begin, end } = markers(store);
  return ['# host skill', '', begin, end, '', 'Comply from the record, never the cell.', ''].join(
    '\n',
  );
}

// Build a throwaway repo (its own temp root per test — no shared state to collide on),
// run the body, and remove it. Every store starts with README + SCHEMA (which discovery
// must ignore) and an empty-current host shell.
function withRepo(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'index-gen-'));
  try {
    for (const store of STORES) {
      const dir = join(root, 'corpus', store);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'README.md'), '# readme\n');
      writeFileSync(join(dir, 'SCHEMA.md'), '# schema\n');
      const target = join(root, INDEX_TARGETS[store]);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, currentEmptyShell(store));
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeEntry(root: string, store: StoreId, name: string, text: string): void {
  writeFileSync(join(root, 'corpus', store, name), text);
}

function readTarget(root: string, store: StoreId): string {
  return readFileSync(join(root, INDEX_TARGETS[store]), 'utf8');
}

// Fixtures. Each payload section carries a distinctive sentinel so a test can assert the
// settlement test holds — the payload never reaches the index.
const D0007 = `---
id: D-0007
status: active
recurrences:
  - gateway: S-003
created: 2026-08-20
---

# a datastore timeout summary that routes but must not be obeyed alone

## Decision
DECISION_PAYLOAD trace pool saturation first.
`;

const D0003 = `---
id: D-0003
status: superseded
superseded-by: D-0007
created: 2026-08-10
---

# an earlier superseded case summary

## Decision
DECISION_PAYLOAD earlier guidance.
`;

const R0002 = `---
id: R-0002
status: active
fires-when: diagnosing latency in a service with a datastore client
not-this: batch jobs with no datastore client
warrant:
  - D-0007
floor: none
residue: presence only
---

# a rule recognition line

## Duty
DUTY_PAYLOAD check pool metrics before upstream causes.
`;

const B0001 = `---
id: B-0001
status: live
consult-when: estimating datastore burst capacity
deadline: 2026-09-01
postdiction: false
created: 2026-08-20
reference:
  class: base-rate
  price:
    value: "0.2"
    source: an-anchor
    as-of: 2026-08-01
---

# a belief summary

## Claim
CLAIM_PAYLOAD the datastore bursts past its pool.
`;

test('discoverEntryFiles matches only the canonical four-digit id shape, ignoring README/SCHEMA/strays', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0007.md', D0007);
    writeEntry(root, 'decisions', 'D-0003.md', D0003);
    writeEntry(root, 'decisions', 'notes.md', '# not an entry\n');
    writeEntry(root, 'decisions', 'D-1.md', D0007); // non-canonical: fewer than four digits
    writeEntry(root, 'decisions', 'D-00001.md', D0007); // non-canonical: more than four digits
    assert.deepEqual(discoverEntryFiles(root, 'decisions'), ['corpus/decisions/D-0003.md', 'corpus/decisions/D-0007.md']);
  });
});

test('discovery spans corpus roots: an incident-tenant entry is indexed alongside the root scaffold (Part B)', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0003.md', D0003); // at the root scaffold
    const tenantDir = join(root, 'tenant-incident', 'corpus', 'decisions');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(join(tenantDir, 'D-0007.md'), D0007); // under the incident tenant — no local SCHEMA
    assert.deepEqual(discoverEntryFiles(root, 'decisions'), [
      'corpus/decisions/D-0003.md',
      'tenant-incident/corpus/decisions/D-0007.md',
    ]);
    const outcome = processStore(root, 'decisions', false);
    assert.equal(outcome.kind, 'written');
    const target = readTarget(root, 'decisions');
    assert.ok(target.includes('- D-0003') && target.includes('- D-0007'), 'both roots reach one index');
  });
});

test('a duplicate id across roots is a named error, not an ambiguous index (cross-root uniqueness)', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0007.md', D0007); // root scaffold
    const tenantDir = join(root, 'tenant-incident', 'corpus', 'decisions');
    mkdirSync(tenantDir, { recursive: true });
    writeFileSync(join(tenantDir, 'D-0007.md'), D0007); // same id under the tenant root
    const outcome = processStore(root, 'decisions', false);
    assert.equal(outcome.kind, 'error');
    assert.match(outcome.kind === 'error' ? outcome.detail : '', /duplicate id D-0007 across corpus roots/);
  });
});

test('an empty store plans an adjacent-marker region and reads as already current', () => {
  withRepo((root) => {
    const plan = planStore(root, 'rules');
    const { begin, end } = markers('rules');
    assert.ok(plan.after.includes(`${begin}\n${end}`));
    assert.equal(plan.current, true);
  });
});

test('write mode fills the region, sorts by id, and never emits the payload', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0007.md', D0007);
    writeEntry(root, 'decisions', 'D-0003.md', D0003);
    const { code } = run(root, []);
    assert.equal(code, 0);
    const out = readTarget(root, 'decisions');
    assert.ok(out.includes(`- D-0003${FIELD_SEP}superseded → D-0007`));
    assert.ok(out.includes(`- D-0007${FIELD_SEP}active`));
    // sorted: D-0003 before D-0007
    assert.ok(out.indexOf('- D-0003') < out.indexOf('- D-0007'));
    // the ## Decision payload is absent — the settlement test
    assert.ok(!out.includes('DECISION_PAYLOAD'));
  });
});

test('the settlement test holds for rules and beliefs too — no duty or claim in the index', () => {
  withRepo((root) => {
    writeEntry(root, 'rules', 'R-0002.md', R0002);
    writeEntry(root, 'beliefs', 'B-0001.md', B0001);
    run(root, []);
    const rules = readTarget(root, 'rules');
    const beliefs = readTarget(root, 'beliefs');
    assert.ok(rules.includes(`- R-0002${FIELD_SEP}residue: presence only`));
    assert.ok(!rules.includes('DUTY_PAYLOAD'));
    assert.ok(beliefs.includes(`- B-0001${FIELD_SEP}consult-when: estimating datastore burst capacity`));
    assert.ok(!beliefs.includes('CLAIM_PAYLOAD'));
  });
});

test('write mode reports written on the first run and unchanged on the next (idempotent)', () => {
  withRepo((root) => {
    writeEntry(root, 'beliefs', 'B-0001.md', B0001);
    const first = processStore(root, 'beliefs', false);
    assert.equal(first.kind, 'written');
    const afterFirst = readTarget(root, 'beliefs');
    const second = processStore(root, 'beliefs', false);
    assert.equal(second.kind, 'unchanged');
    assert.equal(readTarget(root, 'beliefs'), afterFirst);
  });
});

test('a successful write leaves no temporary file behind', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0007.md', D0007);
    processStore(root, 'decisions', false);
    const hostDir = dirname(join(root, INDEX_TARGETS.decisions));
    assert.deepEqual(readdirSync(hostDir).filter((n) => n.includes('.tmp')), []);
  });
});

// A read-only directory denies writes only on POSIX, and only for a non-root user. Where
// it cannot — Windows has no such directory-mode semantics, and root ignores the mode —
// the write failure cannot be provoked, so the coverage is skipped there rather than run
// against a permission model that would not hold and assert a failure that never happens.
const cannotDenyWrites =
  process.platform === 'win32' ||
  (typeof process.getuid === 'function' && process.getuid() === 0);

test(
  'a failed host write leaves the original bytes intact — atomic replace, never truncation',
  { skip: cannotDenyWrites ? 'needs a non-root POSIX user: a read-only dir must deny writes' : false },
  () => {
    withRepo((root) => {
      writeEntry(root, 'decisions', 'D-0007.md', D0007); // makes the host stale, so a write is attempted
      const target = join(root, INDEX_TARGETS.decisions);
      const original = readFileSync(target, 'utf8');
      const hostDir = dirname(target);
      chmodSync(hostDir, 0o500); // read + execute, no write — the temp file cannot be created
      try {
        const outcome = processStore(root, 'decisions', false);
        assert.equal(outcome.kind, 'error');
        assert.equal(readFileSync(target, 'utf8'), original); // host never truncated
      } finally {
        chmodSync(hostDir, 0o700); // restore so the temp dir can be removed
      }
    });
  },
);

test('--check names a stale store, exits non-zero, and writes nothing', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0007.md', D0007);
    const before = readTarget(root, 'decisions');
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /decisions stale/);
    assert.equal(readTarget(root, 'decisions'), before); // nothing written
  });
});

test('--check on fully current stores exits zero', () => {
  withRepo((root) => {
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 0);
    assert.match(report, /all 3 store\(s\) current/);
  });
});

test('a missing host SKILL.md is a named error, and the other stores still process', () => {
  withRepo((root) => {
    rmSync(join(root, INDEX_TARGETS.rules));
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /rules error/);
    assert.match(report, /target SKILL\.md not found: skills\/rules\/SKILL\.md/);
    assert.match(report, /decisions unchanged/); // the run did not abort early
  });
});

test('an entry matching the shape but carrying no id is a named hard error', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0009.md', '---\nstatus: active\n---\n\n# no id here\n');
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /decisions error/);
    assert.match(report, /D-0009\.md/);
  });
});

test('a duplicated marker pair in a host is a named error, not a silent single splice', () => {
  withRepo((root) => {
    const { begin, end } = markers('beliefs');
    writeFileSync(
      join(root, INDEX_TARGETS.beliefs),
      ['# host', begin, end, '', begin, end, ''].join('\n'),
    );
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /beliefs error/);
    assert.match(report, /missing or malformed/);
  });
});

test('a CRLF host is a named error — markers must be verbatim LF lines', () => {
  withRepo((root) => {
    const { begin, end } = markers('decisions');
    writeFileSync(join(root, INDEX_TARGETS.decisions), ['# host', begin, end, ''].join('\r\n'));
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /decisions error/);
    assert.match(report, /missing or malformed/);
  });
});

test('a missing store directory is a named error', () => {
  withRepo((root) => {
    rmSync(join(root, 'corpus', 'beliefs'), { recursive: true });
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /beliefs error/);
    assert.match(report, /store directory not found: corpus\/beliefs/);
  });
});

test('a field carrying the separator is a named error, not a corrupted line', () => {
  withRepo((root) => {
    const badRule = `---
id: R-0002
status: active
fires-when: x
not-this: y
floor: none
residue: a${FIELD_SEP}b
---

# a rule
`;
    writeEntry(root, 'rules', 'R-0002.md', badRule);
    const { code, report } = run(root, ['--check']);
    assert.equal(code, 1);
    assert.match(report, /rules error/);
    assert.match(report, /field separator/);
  });
});

test('an unrecognized argument exits 2 with usage and writes nothing', () => {
  withRepo((root) => {
    writeEntry(root, 'decisions', 'D-0007.md', D0007); // would otherwise be stale
    const before = readTarget(root, 'decisions');
    const { code, report } = run(root, ['--chek']);
    assert.equal(code, 2);
    assert.match(report, /unrecognized argument/);
    assert.match(report, /usage/);
    assert.equal(readTarget(root, 'decisions'), before); // the typo did not trigger a write
  });
});
