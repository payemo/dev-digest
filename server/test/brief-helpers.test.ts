/**
 * PR Brief (L05) — the pure helpers (plan Step 4, tested per Step 9).
 *
 * These are the decisions the model is NOT allowed to make: which files and
 * lines exist in this PR, which of the model's citations survive, how many
 * items are kept, and how each generation input is labelled. Every one is a
 * transform over its arguments — no container, no DB, no mocks.
 *
 * Every expected value below is written out by hand; nothing calls the
 * function under test to compute its own expectation.
 */
import { describe, it, expect } from 'vitest';
import type {
  BlastRadius,
  BlastRadiusResponse,
  PrBriefStored,
  PrIntentRecord,
  ReviewFocusItem,
  Risk,
} from '@devdigest/shared';
import {
  blastSnapshot,
  buildAnchorIndex,
  changedRanges,
  clampSummary,
  inputStatuses,
  parseFileRef,
  postValidate,
  toRecord,
} from '../src/modules/brief/helpers.js';

describe('changedRanges — hunk headers only', () => {
  it('maps multi-hunk, zero-length and missing-length headers to new-side ranges', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' unchanged',
      '+added line',
      '@@ -20,2 +22,0 @@', // pure deletion → anchors at its start line
      '-gone',
      '-also gone',
      '@@ -30 +31 @@ function name()', // missing length means 1; trailing context ignored
      '-old',
      '+new',
    ].join('\n');

    expect(changedRanges(patch)).toEqual([
      { start: 1, end: 4 },
      { start: 22, end: 22 },
      { start: 31, end: 31 },
    ]);
  });

  it('never reads a body line as a header, clamps a deletion at +0 to line 1, and is empty for no patch', () => {
    // A context/added line whose TEXT happens to contain "@@" is still a body line.
    const patch = ['@@ -1,2 +0,0 @@', '-const a = "@@ -9,9 +9,9 @@";', '- x'].join('\n');
    expect(changedRanges(patch)).toEqual([{ start: 1, end: 1 }]);
    expect(changedRanges(null)).toEqual([]);
    expect(changedRanges('')).toEqual([]);
  });
});

describe('parseFileRef', () => {
  it('splits path, path:N and path:N-M, and leaves a non-numeric colon in the path', () => {
    expect(parseFileRef('src/config.ts')).toEqual({ path: 'src/config.ts', suffix: null });
    expect(parseFileRef('src/config.ts:12')).toEqual({ path: 'src/config.ts', suffix: '12' });
    expect(parseFileRef('  src/config.ts:3-9 ')).toEqual({ path: 'src/config.ts', suffix: '3-9' });
    expect(parseFileRef('odd:name.ts')).toEqual({ path: 'odd:name.ts', suffix: null });
  });
});

const BLAST: BlastRadius = {
  changed_symbols: [
    { name: 'rateLimit', file: 'src/api/rate-limit.ts', kind: 'function' },
    // Declared in a file this PR does not change: allowed, but with no known line.
    { name: 'Bucket', file: 'src/lib/bucket.ts', kind: 'class' },
  ],
  downstream: [
    {
      symbol: 'rateLimit',
      callers: [{ name: 'listItems', file: 'src/api/public/items.ts', line: 23 }],
      endpoints_affected: ['GET /api/public/items'],
      crons_affected: [],
    },
  ],
  summary: '1 changed symbol reaches 1 caller',
};

const FILES = [
  {
    path: 'src/api/rate-limit.ts',
    ranges: [
      { start: 40, end: 42 },
      { start: 10, end: 20 },
      { start: 15, end: 21 }, // overlaps the one above → merged to 10-21
    ],
  },
  { path: 'src/config.ts', ranges: [{ start: 12, end: 12 }] },
  { path: 'assets/logo.png', ranges: [] }, // binary: no patch, still a changed file
];

describe('buildAnchorIndex', () => {
  it('keys every changed file, caller file and declaring file, with merged sorted ranges', () => {
    const index = buildAnchorIndex(FILES, BLAST);

    expect([...index.keys()].sort()).toEqual([
      'assets/logo.png',
      'src/api/public/items.ts',
      'src/api/rate-limit.ts',
      'src/config.ts',
      'src/lib/bucket.ts',
    ]);
    expect(index.get('src/api/rate-limit.ts')).toEqual([
      { start: 10, end: 21 },
      { start: 40, end: 42 },
    ]);
    expect(index.get('src/api/public/items.ts')).toEqual([{ start: 23, end: 23 }]);
    expect(index.get('src/lib/bucket.ts')).toEqual([]);
    expect(index.get('assets/logo.png')).toEqual([]);
  });

  it('with no blast map, only the changed files are allowed', () => {
    const index = buildAnchorIndex(FILES, null);
    expect(index.has('src/api/public/items.ts')).toBe(false);
    expect(index.has('src/lib/bucket.ts')).toBe(false);
    expect(index.has('src/config.ts')).toBe(true);
  });
});

const risk = (kind: string, title: string, file_refs: string[]): Risk => ({
  kind,
  title,
  explanation: `${title} explained`,
  severity: 'medium',
  file_refs,
});
const focus = (file: string, line: number): ReviewFocusItem => ({ file, line, reason: `${file}@${line}` });

describe('postValidate — FR-8 (a)–(e), the spec verification case', () => {
  it('drops invented paths, keeps blast-only callers, snaps lines, dedupes, caps at 8, and counts exactly', () => {
    const anchors = buildAnchorIndex(FILES, BLAST);
    const output = {
      risks: [
        risk('security', 'Limiter bypass', ['src/api/rate-limit.ts:12', 'src/invented.ts']),
        risk('contract', 'Caller now throttled', ['src/api/public/items.ts:23']), // blast-only
        risk('performance', 'Pure speculation', ['src/ghost.ts', 'src/api']), // nothing real
        risk('security', 'Same risk, other line', ['src/api/rate-limit.ts:15']), // dup of #1
      ],
      review_focus: [
        focus('src/config.ts', 12), // exact
        focus('src/api/rate-limit.ts', 30), // gap 21..40: 9 below vs 10 above → 21
        focus('src/invented.ts', 5), // unknown file → dropped
        focus('src/api/public/items.ts', 99), // blast-only file → snapped to caller line 23
        focus('src/config.ts', 12), // duplicate → collapsed
        focus('src/api/rate-limit.ts', 10),
        focus('src/api/rate-limit.ts', 11),
        focus('src/api/rate-limit.ts', 12),
        focus('src/api/rate-limit.ts', 13),
        focus('src/api/rate-limit.ts', 14),
        focus('src/api/rate-limit.ts', 41),
        focus('src/api/rate-limit.ts', 0), // snapped to 10 → then a duplicate of line 10
      ],
    };

    const result = postValidate(output, anchors);

    expect(result.risks.map((r) => [r.title, r.file_refs])).toEqual([
      ['Limiter bypass', ['src/api/rate-limit.ts:12']],
      ['Caller now throttled', ['src/api/public/items.ts:23']],
    ]);
    // 9 unique survivors (the last, rate-limit:41, is cut), 8 kept in the model's order.
    expect(result.review_focus.map((f) => `${f.file}:${f.line}`)).toEqual([
      'src/config.ts:12',
      'src/api/rate-limit.ts:21',
      'src/api/public/items.ts:23',
      'src/api/rate-limit.ts:10',
      'src/api/rate-limit.ts:11',
      'src/api/rate-limit.ts:12',
      'src/api/rate-limit.ts:13',
      'src/api/rate-limit.ts:14',
    ]);
    // The reason travels with its item even when the line moved.
    expect(result.review_focus[1]!.reason).toBe('src/api/rate-limit.ts@30');
    expect(result.validation).toEqual({
      risks_dropped: 1,
      refs_stripped: 3, // src/invented.ts, src/ghost.ts, src/api
      focus_dropped: 1,
      focus_snapped: 3, // :30 → 21, :99 → 23, :0 → 10
      duplicates_collapsed: 3, // one risk + two focus items
    });
  });

  it('snaps to the lower anchor on a tie, and clamps a line on a file with no known lines to ≥ 1', () => {
    const anchors = buildAnchorIndex(
      [{ path: 'a.ts', ranges: [{ start: 10, end: 10 }, { start: 20, end: 20 }] }],
      BLAST,
    );
    const result = postValidate(
      {
        risks: [],
        review_focus: [focus('a.ts', 15), focus('src/lib/bucket.ts', -4), focus('src/lib/bucket.ts', 7)],
      },
      anchors,
    );
    expect(result.review_focus.map((f) => `${f.file}:${f.line}`)).toEqual([
      'a.ts:10',
      'src/lib/bucket.ts:1',
      'src/lib/bucket.ts:7',
    ]);
    expect(result.validation.focus_snapped).toBe(2);
  });

  it('caps risks at 6, keeping the first six', () => {
    const anchors = buildAnchorIndex([{ path: 'a.ts', ranges: [{ start: 1, end: 5 }] }], null);
    const risks = Array.from({ length: 9 }, (_, i) => risk(`kind-${i}`, `Risk ${i}`, ['a.ts']));
    const result = postValidate({ risks, review_focus: [] }, anchors);
    expect(result.risks.map((r) => r.title)).toEqual([
      'Risk 0',
      'Risk 1',
      'Risk 2',
      'Risk 3',
      'Risk 4',
      'Risk 5',
    ]);
    // Capping is not "dropping": the validation counts only grounding changes.
    expect(result.validation.risks_dropped).toBe(0);
  });

  it('treats two risks of the same kind on different path sets as distinct', () => {
    const anchors = buildAnchorIndex(
      [
        { path: 'a.ts', ranges: [] },
        { path: 'b.ts', ranges: [] },
      ],
      null,
    );
    const result = postValidate(
      {
        risks: [
          risk('security', 'One', ['a.ts']),
          risk('security', 'Two', ['a.ts', 'b.ts']),
          risk('security', 'Three', ['b.ts:4', 'a.ts:9']), // same path set as Two
        ],
        review_focus: [],
      },
      anchors,
    );
    expect(result.risks.map((r) => r.title)).toEqual(['One', 'Two']);
    expect(result.validation.duplicates_collapsed).toBe(1);
  });
});

describe('clampSummary', () => {
  it('trims a short summary and leaves it otherwise untouched', () => {
    expect(clampSummary('  Adds rate limiting.  ')).toBe('Adds rate limiting.');
  });

  it('cuts a long summary on a word boundary with an ellipsis, within the cap', () => {
    const long = `${'word '.repeat(100)}end`; // 503 chars
    const out = clampSummary(long);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith('word…')).toBe(true);
  });

  it('hard-cuts a summary with no usable space', () => {
    const out = clampSummary('x'.repeat(500));
    expect(out).toBe(`${'x'.repeat(399)}…`);
  });
});

const INTENT: PrIntentRecord = {
  intent: 'Stop one client from exhausting the pool.',
  in_scope: [],
  out_of_scope: [],
  pr_id: 'pr-1',
  confidence: 0.5,
  risk_areas: [],
  sources: [],
  derived_at: '2026-09-01T00:00:00.000Z',
  is_stale: false,
};
const BLAST_RESPONSE: BlastRadiusResponse = { ...BLAST };

describe('inputStatuses — D3', () => {
  it('marks everything present when every input is there', () => {
    expect(
      inputStatuses({
        intent: INTENT,
        blast: BLAST_RESPONSE,
        description: 'Why this exists',
        linkedIssue: { title: 'Pool exhaustion', body: null },
        specsCount: 2,
      }),
    ).toEqual({
      intent: 'present',
      blast: 'present',
      description: 'present',
      linked_issue: 'present',
      project_context: 'present',
    });
  });

  it('marks absent inputs missing, a stale intent stale, and a whitespace description missing', () => {
    expect(
      inputStatuses({
        intent: { ...INTENT, is_stale: true },
        blast: null,
        description: '   \n ',
        linkedIssue: null,
        specsCount: 0,
      }),
    ).toEqual({
      intent: 'stale',
      blast: 'missing',
      description: 'missing',
      linked_issue: 'missing',
      project_context: 'missing',
    });
    expect(inputStatuses({ intent: null, blast: null, description: null, linkedIssue: null, specsCount: 0 }).intent).toBe(
      'missing',
    );
  });

  it('tells a degraded-but-useful blast (partial) from a degraded empty one (missing)', () => {
    const base = { intent: null, description: null, linkedIssue: null, specsCount: 0 };
    expect(inputStatuses({ ...base, blast: { ...BLAST, degraded: true, reason: 'index_partial' } }).blast).toBe(
      'partial',
    );
    expect(
      inputStatuses({
        ...base,
        blast: { changed_symbols: [], downstream: [], summary: '', degraded: true, reason: 'no_data' },
      }).blast,
    ).toBe('missing');
  });
});

describe('blastSnapshot', () => {
  it('strips the live-only degraded/reason keys, and is null when blast is missing', () => {
    const snap = blastSnapshot({ ...BLAST, degraded: true, reason: 'index_partial' });
    expect(snap).toEqual(BLAST);
    expect(snap).not.toHaveProperty('degraded');
    expect(snap).not.toHaveProperty('reason');
    expect(
      blastSnapshot({ changed_symbols: [], downstream: [], summary: '', degraded: true }),
    ).toBeNull();
    expect(blastSnapshot(null)).toBeNull();
  });
});

describe('toRecord — staleness is derived on read', () => {
  const stored = { head_sha: 'a1b2c3d4', summary: 's' } as PrBriefStored;
  it('is fresh on the same head and stale on a moved head', () => {
    expect(toRecord(stored, 'a1b2c3d4').is_stale).toBe(false);
    expect(toRecord(stored, 'f9e8d7c6').is_stale).toBe(true);
    expect(toRecord(stored, 'f9e8d7c6').head_sha).toBe('a1b2c3d4');
  });
});
