import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from './qodo-gate-lib.ts';
import {
  QODO_BOT_LOGIN,
  buildRemediationSeed,
  classify,
  countGateMarkers,
  flattenPages,
  isGatingSeverity,
  isQodoBot,
  normalizeTitle,
  openGatingFindings,
  parseInlineFindings,
  parseSummary,
  stripHtml,
  type RawInlineComment,
} from './qodo-gate-lib.ts';

// Fixtures modelled on real Qodo output captured from slavazin/ember PR #20:
// severity rides a shields.io badge URL; the summary comment is the resolution authority.

const highInlineBody = [
  '<img src="https://img.shields.io/badge/High-634FD1?style=flat-square" height="20px" alt="Action required">',
  '',
  '1\\. Adr draft id contradiction <code>🐞 Bug</code> <code>≡ Correctness</code>',
  '',
  '<pre>',
  'The revised tenant ADR schema requires an ID to be reserved when the draft is filed.',
  '</pre>',
  '',
  '<details>',
  '<summary><strong>Agent Prompt</strong></summary>',
  '',
  '```',
  '## Issue description',
  'IDs are reserved at draft but the shared procedure leaves them empty.',
  '## Fix Focus Areas',
  '- skills/corpus-write/SKILL.md[27-40]',
  '```',
  '',
  '<code>ⓘ Copy this prompt and use it to remediate the issue</code>',
  '</details>',
].join('\n');

const mediumInlineBody = [
  '<img src="https://img.shields.io/badge/Medium-634FD1?style=flat-square" height="20px" alt="Remediation recommended">',
  '',
  '1\\. Minor naming nit <code>🐞 Bug</code>',
  '',
  '<pre>A smaller concern.</pre>',
].join('\n');

const resolvedHighInlineBody = [
  '<img src="https://img.shields.io/badge/High-634FD1?style=flat-square" height="20px" alt="Action required">',
  '',
  '1\\. Some resolved thing <code>🐞 Bug</code> <code>≡ Correctness</code>',
  '',
  '<pre>Already fixed.</pre>',
].join('\n');

function inline(body: string, path?: string, line?: number): RawInlineComment {
  return { body, path, line, user: { login: 'qodo-code-review[bot]' } };
}

test('parseInlineFindings extracts severity, title, agent prompt, and anchor from a High finding', () => {
  const [f] = parseInlineFindings([inline(highInlineBody, 'tenant-build/corpus/decisions/SCHEMA.md', 5)]);
  assert.ok(f);
  assert.equal(f.severity, 'high');
  assert.equal(f.gating, true);
  assert.equal(f.title, 'Adr draft id contradiction');
  assert.equal(f.path, 'tenant-build/corpus/decisions/SCHEMA.md');
  assert.equal(f.line, 5);
  assert.match(f.agentPrompt, /Fix Focus Areas/);
  assert.match(f.agentPrompt, /corpus-write\/SKILL\.md\[27-40\]/);
});

test('parseInlineFindings marks Medium as non-gating', () => {
  const [f] = parseInlineFindings([inline(mediumInlineBody)]);
  assert.ok(f);
  assert.equal(f.severity, 'medium');
  assert.equal(f.gating, false);
});

test('parseInlineFindings drops comments with no severity badge (not Qodo findings)', () => {
  const findings = parseInlineFindings([
    inline('Just a plain review remark with no badge.'),
    inline(highInlineBody),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, 'high');
});

test('isGatingSeverity treats High and any future Critical as gating; Low/Medium not', () => {
  assert.equal(isGatingSeverity('High'), true);
  assert.equal(isGatingSeverity('critical'), true);
  assert.equal(isGatingSeverity('BLOCKER'), true); // unknown-but-present severity gates, conservatively
  assert.equal(isGatingSeverity('Medium'), false);
  assert.equal(isGatingSeverity('low'), false);
});

test('parseSummary reads the open-bug count and per-finding resolution', () => {
  const body = [
    'Code Review by Qodo',
    '',
    '🐞 Bugs (1)  📘 Rule violations (0)  📜 Skill insights (0)',
    '',
    '  1.  Adr draft id contradiction Action required 🐞 Bug ≡ Correctness',
    '  2.  Some resolved thing ✓ Resolved 🐞 Bug ≡ Correctness',
  ].join('\n');
  const summary = parseSummary(body);
  assert.equal(summary.bugCount, 1);
  assert.equal(summary.findings.length, 2);
  const open = summary.findings.find((f) => normalizeTitle(f.title) === normalizeTitle('Adr draft id contradiction'));
  const done = summary.findings.find((f) => normalizeTitle(f.title) === normalizeTitle('Some resolved thing'));
  assert.equal(open?.resolved, false);
  assert.equal(done?.resolved, true);
});

test('parseSummary takes the largest bug count across sections and strips HTML', () => {
  const body = '<p>🐞 Bugs (0)</p> <div>🐞 Bugs (2)</div>';
  assert.equal(parseSummary(body).bugCount, 2);
});

test('stripHtml decodes the entities Qodo emits', () => {
  assert.equal(stripHtml('a&#x27;s &amp; b <b>c</b>'), "a's & b c");
});

test('openGatingFindings joins sources: only open High findings survive', () => {
  const summary = parseSummary(
    [
      '🐞 Bugs (1)',
      '  1.  Adr draft id contradiction Action required 🐞 Bug',
      '  2.  Some resolved thing ✓ Resolved 🐞 Bug',
    ].join('\n'),
  );
  const inlineFindings = parseInlineFindings([
    inline(highInlineBody), // open High
    inline(resolvedHighInlineBody), // High but resolved in summary
    inline(mediumInlineBody), // open Medium — not gating
  ]);
  const open = openGatingFindings(inlineFindings, summary);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.title, 'Adr draft id contradiction');
});

test('openGatingFindings treats a finding absent from the summary as open (conservative)', () => {
  const summary = parseSummary('🐞 Bugs (1)\n  1.  Unrelated thing ✓ Resolved 🐞 Bug');
  const inlineFindings = parseInlineFindings([inline(highInlineBody)]);
  assert.equal(openGatingFindings(inlineFindings, summary).length, 1);
});

test('classify: no open High is clean regardless of round', () => {
  assert.equal(classify([], 1, 2).action, 'clean');
  assert.equal(classify([], 9, 2).action, 'clean');
});

test('classify: open High remediates within the round cap and exhausts past it', () => {
  const [high] = parseInlineFindings([inline(highInlineBody)]);
  assert.ok(high);
  assert.equal(classify([high], 1, 2).action, 'remediate'); // original close's gate
  assert.equal(classify([high], 2, 2).action, 'remediate'); // 2nd remediation still allowed
  assert.equal(classify([high], 3, 2).action, 'exhausted'); // past the cap → surface to human
});

test('buildRemediationSeed embeds the PR, branch, every finding, and forbids merging', () => {
  const openHigh = parseInlineFindings([inline(highInlineBody, 'skills/corpus-write/SKILL.md', 27)]);
  const seed = buildRemediationSeed({ pr: 42, branch: 'incident/foo', openHigh, round: 1, maxRounds: 2 });
  assert.match(seed, /PR #42/);
  assert.match(seed, /incident\/foo/);
  assert.match(seed, /Adr draft id contradiction/);
  assert.match(seed, /Fix Focus Areas/); // the Agent Prompt block is carried through
  assert.match(seed, /do NOT merge/i); // Articles 2 & 10 — never auto-merge
});

test('the gate library exposes no merge/admit action (never auto-merges)', () => {
  for (const name of Object.keys(lib)) {
    assert.doesNotMatch(name, /merge|admit|approve/i, `unexpected export ${name}`);
  }
});

// Qodo #23-1: identity must be the exact bot, not a spoofable name fragment.
test('isQodoBot authenticates the exact bot login only', () => {
  assert.equal(isQodoBot(QODO_BOT_LOGIN), true);
  assert.equal(isQodoBot('qodo-code-review[bot]'), true);
  assert.equal(isQodoBot('qodofake'), false);
  assert.equal(isQodoBot('evil-qodo-impersonator'), false);
  assert.equal(isQodoBot(undefined), false);
});

// Qodo #23-4: a resolved item must not hide a distinct open High with a colliding title.
test('openGatingFindings keeps colliding titles open (ambiguous match is never suppressed)', () => {
  // Two DISTINCT inline High findings normalize to the same key; the summary resolves one.
  const dupA = highInlineBody; // "Adr draft id contradiction"
  // Same title, materially different finding body → same normalized key, distinct bug.
  const dupB = highInlineBody.replace('IDs are reserved at draft', 'A different underlying cause');
  const summary = parseSummary('🐞 Bugs (1)\n  1.  Adr draft id contradiction ✓ Resolved 🐞 Bug');
  const inlineFindings = parseInlineFindings([inline(dupA), inline(dupB)]);
  // Ambiguous on the inline side → neither is suppressed by the single resolved summary entry.
  assert.equal(openGatingFindings(inlineFindings, summary).length, 2);
});

test('openGatingFindings suppresses only an unambiguous, resolved match', () => {
  const summary = parseSummary('🐞 Bugs (0)\n  1.  Adr draft id contradiction ✓ Resolved 🐞 Bug');
  const inlineFindings = parseInlineFindings([inline(highInlineBody)]);
  assert.equal(openGatingFindings(inlineFindings, summary).length, 0);
});

// Qodo #23-3: rounds derive from the gate's own markers, not arbitrary /agentic_review mentions.
test('countGateMarkers counts only bodies carrying the machine-owned marker', () => {
  const marker = '<!-- qodo-gate-cycle -->';
  const bodies = [
    '/agentic_review', // an old manual trigger — must NOT count
    `/agentic_review\n\n${marker}`, // a gate cycle — counts
    'unrelated comment mentioning /agentic_review in prose', // must NOT count
    `re-run\n${marker}`, // counts
  ];
  assert.equal(countGateMarkers(bodies, marker), 2);
});

// Qodo #23-2: paginated gh output is an array of page-arrays; flatten to one flat array.
test('flattenPages flattens an array of page arrays', () => {
  assert.deepEqual(flattenPages<number>([[1, 2], [3], []]), [1, 2, 3]);
  assert.deepEqual(flattenPages<number>([[1]]), [1]);
  assert.throws(() => flattenPages<number>({ not: 'an array' }), /array of pages/);
});
