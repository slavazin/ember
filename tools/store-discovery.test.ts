import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { corpusRoots, layerEntryDirs, layerEntryFiles } from './store-discovery.ts';

function withTree(files: Record<string, string>, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'store-discovery-'));
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

test('corpusRoots: corpus/ leads, then every tenant-*/corpus/, sorted; non-tenant dirs ignored', () => {
  withTree(
    {
      'corpus/decisions/README.md': '#',
      'tenant-incident/corpus/decisions/D-0001.md': '#',
      'tenant-build/corpus/decisions/ADR-0001.md': '#',
      'tools/x.ts': '#', // not a corpus root
      'skills/y/SKILL.md': '#', // not a corpus root
    },
    (root) => {
      assert.deepEqual(corpusRoots(root), ['corpus', 'tenant-build/corpus', 'tenant-incident/corpus']);
    },
  );
});

test('corpusRoots: always includes corpus even when no tenant trees exist', () => {
  withTree({ 'corpus/decisions/README.md': '#' }, (root) => {
    assert.deepEqual(corpusRoots(root), ['corpus']);
  });
});

test('layerEntryDirs: the root scaffold plus tenant dirs WITHOUT their own SCHEMA; a self-describing store is excluded', () => {
  withTree(
    {
      'corpus/decisions/SCHEMA.md': '#', // layer scaffold (defines the contract)
      'tenant-incident/corpus/decisions/D-0001.md': '#', // co-references the layer SCHEMA
      'tenant-build/corpus/decisions/SCHEMA.md': '#', // ships its OWN SCHEMA → self-describing
      'tenant-build/corpus/decisions/ADR-0001.md': '#',
    },
    (root) => {
      assert.deepEqual(layerEntryDirs(root, 'decisions'), ['corpus/decisions', 'tenant-incident/corpus/decisions']);
    },
  );
});

test('layerEntryFiles: gathers entries across layer-contract roots, excluding README/SCHEMA and self-describing stores', () => {
  withTree(
    {
      'corpus/decisions/SCHEMA.md': '#',
      'corpus/decisions/README.md': '#',
      'corpus/decisions/D-0002.md': '#',
      'tenant-incident/corpus/decisions/D-0001.md': '#',
      'tenant-build/corpus/decisions/SCHEMA.md': '#', // self-describing → excluded
      'tenant-build/corpus/decisions/ADR-0001.md': '#',
    },
    (root) => {
      assert.deepEqual(layerEntryFiles(root, 'decisions'), [
        'corpus/decisions/D-0002.md',
        'tenant-incident/corpus/decisions/D-0001.md',
      ]);
    },
  );
});

test('layerEntryDirs: a missing store yields no dirs (a store may be genesis-empty)', () => {
  withTree({ 'corpus/decisions/README.md': '#' }, (root) => {
    assert.deepEqual(layerEntryDirs(root, 'rules'), []);
    assert.deepEqual(layerEntryFiles(root, 'rules'), []);
  });
});
