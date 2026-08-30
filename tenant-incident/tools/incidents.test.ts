import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { loadCorpus, checkCorpus, parseIncidentFile, isEntryFile, type Problem } from './incidents.ts';

// A minimal valid closed case, reused and mutated per test.
const INCIDENT = `---
id: INC-0001
status: closed
class: connection-storm
surface: orders-svc
forecast-outcome: hit
disposition: applied
related: []
occurred: 2026-08-27
closed: 2026-08-29
---

# a retry storm exhausted the pool and the class learned to probe saturation first

## Incident
Timeouts under load (observed 2026-08-27, incident A).

## Forecast
The pool-saturation probe predicted the storm below the ceiling and it held (observed 2026-08-27).

## Root cause
Unbounded retries multiplied concurrent checkouts past the pool ceiling.

## Learning
A later case of this class probes saturation before committing a fix.

## Evidence
- PR #1 — the fix.
`;

// Write INC files into a fresh temp store dir, run fn(problems), then clean up.
function withStore(files: Record<string, string>, fn: (problems: Problem[]) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'incidents-'));
  const dir = join(root, 'tenant-incident', 'corpus', 'incidents');
  mkdirSync(dir, { recursive: true });
  try {
    for (const [name, content] of Object.entries(files)) {
      const abs = join(dir, name);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    fn(checkCorpus(loadCorpus(dir)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const msgs = (ps: Problem[]) => ps.map((p) => p.message);

test('isEntryFile: exact four digits only', () => {
  assert.equal(isEntryFile('INC-0001.md'), true);
  assert.equal(isEntryFile('INC-1.md'), false);
  assert.equal(isEntryFile('INC-00001.md'), false);
  assert.equal(isEntryFile('README.md'), false);
});

test('a genesis-empty store (only standing files) passes with zero problems', () => {
  withStore(
    { 'README.md': '# incident case ledger\n', 'SCHEMA.md': '# SCHEMA\n' },
    (problems) => assert.deepEqual(problems, []),
  );
});

test('a well-formed case passes', () => {
  withStore({ 'INC-0001.md': INCIDENT }, (problems) => assert.deepEqual(problems, []));
});

test('a stray non-canonical .md is reported, not silently ignored', () => {
  withStore({ 'orders-pool-saturation.md': INCIDENT.replace('id: INC-0001', 'id: INC-0001') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /not a canonical INC-nnnn\.md filename/.test(m)), JSON.stringify(problems)),
  );
});

test('id must be canonical and equal to the filename', () => {
  withStore({ 'INC-0001.md': INCIDENT.replace('id: INC-0001', 'id: INC-0002') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /filename must equal INC-0002\.md/.test(m)), JSON.stringify(problems)),
  );
});

test('status, forecast-outcome, and disposition are closed vocabularies', () => {
  withStore({ 'INC-0001.md': INCIDENT.replace('status: closed', 'status: open') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /status open/.test(m))),
  );
  withStore({ 'INC-0001.md': INCIDENT.replace('forecast-outcome: hit', 'forecast-outcome: maybe') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /forecast-outcome maybe/.test(m))),
  );
  withStore({ 'INC-0001.md': INCIDENT.replace('disposition: applied', 'disposition: ignored') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /disposition ignored/.test(m))),
  );
});

test('a missing required section fails', () => {
  withStore({ 'INC-0001.md': INCIDENT.replace('## Root cause\n', '') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /missing required section: ## Root cause/.test(m)), JSON.stringify(problems)),
  );
});

test('a non-ISO date fails', () => {
  withStore({ 'INC-0001.md': INCIDENT.replace('occurred: 2026-08-27', 'occurred: 08/27/2026') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /occurred must be an ISO date/.test(m))),
  );
});

test('an unknown frontmatter key is a typo guard', () => {
  withStore({ 'INC-0001.md': INCIDENT.replace('surface: orders-svc', 'surface: orders-svc\nsurfaec: typo') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /unknown frontmatter key: surfaec/.test(m))),
  );
});

test('supersession: superseded needs a resolvable pointer; a closed case carries none', () => {
  // superseded without a successor pointer
  withStore({ 'INC-0001.md': INCIDENT.replace('status: closed', 'status: superseded') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /status superseded requires superseded-by/.test(m))),
  );
  // superseded-by present but status is not superseded
  withStore({ 'INC-0001.md': INCIDENT.replace('related: []', 'related: []\nsuperseded-by: INC-0002') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /superseded-by set but status is closed/.test(m))),
  );
  // superseded-by dangling (no such entry)
  withStore(
    { 'INC-0001.md': INCIDENT.replace('status: closed', 'status: superseded').replace('related: []', 'related: []\nsuperseded-by: INC-0009') },
    (problems) => assert.ok(msgs(problems).some((m) => /superseded-by INC-0009 resolves to no entry/.test(m))),
  );
  // superseded-by that resolves passes
  withStore(
    {
      'INC-0001.md': INCIDENT.replace('status: closed', 'status: superseded').replace('related: []', 'related: []\nsuperseded-by: INC-0002'),
      'INC-0002.md': INCIDENT.replace('id: INC-0001', 'id: INC-0002'),
    },
    (problems) => assert.deepEqual(problems, []),
  );
});

test('related may cite other stores; a same-store dangling INC ref fails; self-reference fails', () => {
  // a cross-store id (a nominated rule) is left for that store to resolve
  withStore({ 'INC-0001.md': INCIDENT.replace('related: []', 'related: [R-0004]') }, (problems) =>
    assert.deepEqual(problems, []),
  );
  // a same-store INC ref that does not resolve
  withStore({ 'INC-0001.md': INCIDENT.replace('related: []', 'related: [INC-0009]') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /related INC-0009 resolves to no entry/.test(m))),
  );
  // self-reference
  withStore({ 'INC-0001.md': INCIDENT.replace('related: []', 'related: [INC-0001]') }, (problems) =>
    assert.ok(msgs(problems).some((m) => /related lists the entry itself/.test(m))),
  );
});

test('parseIncidentFile: malformed frontmatter is a per-file error, not a crash', () => {
  const { errors } = parseIncidentFile('INC-0001.md', '# no frontmatter here\n');
  assert.ok(errors.some((e) => /no frontmatter block/.test(e)));
});
