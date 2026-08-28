// store-discovery — the one filesystem pass that finds the corpus stores, shared by
// corpus-lint (verifier) and index-gen (producer) so the two resolve the SAME set of
// entry directories and cannot drift. index-contract.ts stays pure (parse/render only);
// this module is the impure discovery layer that sits beside it.
//
// The layer scaffold at repo root (`corpus/<store>/` — README + SCHEMA pairs) defines each
// store's DEFAULT contract. A tenant instantiates a store one of two ways:
//
//   - co-referencing the layer SCHEMA — entries only, under `tenant-*/corpus/<store>/*.md`,
//     validated against the layer contract (the incident tenant's decisions/rules/beliefs);
//   - shipping its OWN SCHEMA — a self-describing store with its own contract, validated by
//     its own tool (tenant-build's ADR store → `adr check`). Such a store is EXCLUDED from
//     the layer-contract entry checks: applying one store's contract to another is the
//     lifecycle-overreach mistake (BS-0012), so its own validator owns it.
//
// Roots are discovered by convention (`corpus/` + `tenant-*/corpus/`), never a hand-kept
// list (Constitution Art. 8). The per-store contract is the judgment that stays hand-authored.

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Repo-relative corpus roots: the layer scaffold `corpus/`, plus every `tenant-*/corpus/`
// that exists. Sorted and deterministic; `corpus` always leads.
export function corpusRoots(root: string): string[] {
  const roots = ['corpus'];
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return roots;
  }
  for (const name of names.sort()) {
    if (name.startsWith('tenant-') && isDir(join(root, name, 'corpus'))) {
      roots.push(`${name}/corpus`);
    }
  }
  return roots;
}

// The entry directories governed by the LAYER contract for `store`, repo-relative: the root
// scaffold dir, plus any tenant dir for that store that co-references the layer SCHEMA (ships
// none of its own). A tenant dir carrying its own SCHEMA.md is self-describing and is left out
// — its own tool validates it (decision 4 / Art. 11: schema imported, ceremony declined).
export function layerEntryDirs(root: string, store: string): string[] {
  const dirs: string[] = [];
  for (const cr of corpusRoots(root)) {
    const dir = join(root, cr, store);
    if (!isDir(dir)) continue;
    const selfDescribing = cr !== 'corpus' && existsSync(join(dir, 'SCHEMA.md'));
    if (!selfDescribing) dirs.push(`${cr}/${store}`);
  }
  return dirs;
}

// Entry files (repo-relative, drafts included) of a layer-contract store across all its entry
// dirs, minus the two standing files. Lexically sorted within each dir; readers that need a
// canonical order sort by id at render time.
export function layerEntryFiles(root: string, store: string): string[] {
  const out: string[] = [];
  for (const dir of layerEntryDirs(root, store)) {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (name.endsWith('.md') && name !== 'README.md' && name !== 'SCHEMA.md') {
        out.push(`${dir}/${name}`);
      }
    }
  }
  return out;
}
