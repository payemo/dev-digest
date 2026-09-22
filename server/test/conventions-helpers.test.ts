import { describe, it, expect } from 'vitest';
import type { ConventionRow } from '../src/db/rows.js';
import {
  buildSkillDraft,
  dedupeCandidates,
  renderSample,
  renderSamples,
  ruleKey,
  toSampledFile,
  verifyCandidate,
  type RawCandidate,
  type SampledFile,
  type VerifiedCandidate,
} from '../src/modules/conventions/helpers.js';
import { MIN_SNIPPET_CHARS } from '../src/modules/conventions/constants.js';

/**
 * Pure helpers for the Conventions Extractor: sample rendering (what the model
 * sees), the evidence gate (what survives to be shown/persisted), dedupe, and
 * the skill-draft assembler. No IO, no model, no DB.
 */

function file(path: string, raw: string): SampledFile {
  return toSampledFile(path, raw);
}

function filesMap(...entries: SampledFile[]): Map<string, SampledFile> {
  return new Map(entries.map((f) => [f.path, f]));
}

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
  return {
    category: 'errors',
    rule: 'Always use async/await instead of .then() chains.',
    rationale: 'Keeps error handling in one style.',
    evidence_path: 'src/api/users.ts',
    evidence_line: 2,
    evidence_snippet: 'const user = await db.users.find(id);',
    confidence: 0.85,
    ...overrides,
  };
}

function row(overrides: Partial<ConventionRow> = {}): ConventionRow {
  return {
    id: 'conv-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    category: 'errors',
    rule: 'Always use async/await instead of .then() chains.',
    rationale: null,
    evidencePath: 'src/api/users.ts',
    evidenceLine: 23,
    evidenceSnippet: 'const user = await db.users.find(id);',
    confidence: 0.9,
    status: 'approved',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as ConventionRow;
}

describe('renderSample / renderSamples', () => {
  it('numbers lines from 1 with a tab gutter', () => {
    const f = file('a.ts', 'const a = 1;\nconst b = 2;');
    const rendered = renderSample(f);
    expect(rendered).toContain('--- FILE: a.ts ---');
    expect(rendered).toContain('1\tconst a = 1;');
    expect(rendered).toContain('2\tconst b = 2;');
  });

  it('marks a truncated file', () => {
    const raw = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const f = file('big.ts', raw);
    expect(f.truncated).toBe(true);
    expect(renderSample(f)).toContain('… (truncated)');
  });

  it('stops joining samples once the char budget is exceeded', () => {
    const f1 = file('a.ts', 'x'.repeat(50));
    const f2 = file('b.ts', 'y'.repeat(50));
    // The first rendered block alone is ~70 chars; a 100-char budget fits it
    // but not both.
    const joined = renderSamples([f1, f2], 100);
    expect(joined).toContain('a.ts');
    expect(joined).not.toContain('b.ts');
  });
});

describe('verifyCandidate — the evidence gate', () => {
  const sampleFile = file(
    'src/api/users.ts',
    ['import { db } from "../db";', 'const user = await db.users.find(id);', 'return user;'].join('\n'),
  );

  it('accepts a candidate whose snippet really occurs at the claimed line', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(files, candidate());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.evidencePath).toBe('src/api/users.ts');
      expect(result.candidate.evidenceLine).toBe(2);
      expect(result.candidate.evidenceSnippet).toContain('await db.users.find(id)');
    }
  });

  it('drops a candidate that cites a file we never sampled', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(files, candidate({ evidence_path: 'src/api/other.ts' }));
    expect(result).toEqual({ ok: false, reason: 'unknown_file' });
  });

  it('drops line 0', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(files, candidate({ evidence_line: 0 }));
    expect(result).toEqual({ ok: false, reason: 'invalid_line' });
  });

  it('drops a negative line', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(files, candidate({ evidence_line: -3 }));
    expect(result).toEqual({ ok: false, reason: 'invalid_line' });
  });

  it('drops a line number far beyond the file length when the snippet also cannot be found', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(
      files,
      candidate({ evidence_line: 9999, evidence_snippet: 'this text is not in the file at all' }),
    );
    expect(result).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('drops a blank snippet', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(files, candidate({ evidence_snippet: '   \n  \n' }));
    expect(result).toEqual({ ok: false, reason: 'snippet_too_short' });
  });

  it('drops a comment-only snippet even when it is long enough to pass the char count', () => {
    const files = filesMap(
      file('src/notes.ts', '// this repository always wraps async calls for consistency\nconst x = 1;'),
    );
    const result = verifyCandidate(
      files,
      candidate({
        evidence_path: 'src/notes.ts',
        evidence_line: 1,
        evidence_snippet: '// this repository always wraps async calls for consistency',
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'comment_only' });
  });

  it('drops a snippet shorter than the minimum substantial length', () => {
    const files = filesMap(file('src/tiny.ts', 'x\n}'));
    const result = verifyCandidate(
      files,
      candidate({ evidence_path: 'src/tiny.ts', evidence_line: 2, evidence_snippet: '}' }),
    );
    expect(result).toEqual({ ok: false, reason: 'snippet_too_short' });
    // sanity: the fixture really is under the threshold
    expect('}'.length).toBeLessThan(MIN_SNIPPET_CHARS);
  });

  it('accepts a matching quote and drops a mismatching one', () => {
    const files = filesMap(sampleFile);
    const match = verifyCandidate(files, candidate({ evidence_snippet: 'const user = await db.users.find(id);' }));
    expect(match.ok).toBe(true);

    const mismatch = verifyCandidate(
      files,
      candidate({ evidence_snippet: 'const invented = await somethingThatIsNotThere();' }),
    );
    expect(mismatch).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('rejects an absolute path and a `..` traversal segment', () => {
    const files = filesMap(sampleFile);
    expect(verifyCandidate(files, candidate({ evidence_path: '/etc/passwd' }))).toEqual({
      ok: false,
      reason: 'path_traversal',
    });
    expect(
      verifyCandidate(files, candidate({ evidence_path: '../../etc/passwd' })),
    ).toEqual({ ok: false, reason: 'path_traversal' });
  });

  it('rejects confidence outside [0, 1]', () => {
    const files = filesMap(sampleFile);
    expect(verifyCandidate(files, candidate({ confidence: -0.1 }))).toEqual({
      ok: false,
      reason: 'confidence_out_of_range',
    });
    expect(verifyCandidate(files, candidate({ confidence: 1.5 }))).toEqual({
      ok: false,
      reason: 'confidence_out_of_range',
    });
  });

  it('resolves an unambiguous suffix match (model cites "./a.ts" or "a.ts")', () => {
    const files = filesMap(sampleFile);
    const result = verifyCandidate(files, candidate({ evidence_path: './src/api/users.ts' }));
    expect(result.ok).toBe(true);
  });

  it('does not resolve an ambiguous suffix match', () => {
    const files = filesMap(
      file('pkg-a/users.ts', 'const user = await db.users.find(id);'),
      file('pkg-b/users.ts', 'const user = await db.users.find(id);'),
    );
    const result = verifyCandidate(files, candidate({ evidence_path: 'users.ts' }));
    expect(result).toEqual({ ok: false, reason: 'unknown_file' });
  });

  it('corrects a wrong line number when the snippet is found elsewhere in the same file', () => {
    const files = filesMap(sampleFile);
    // The model claims line 1, but the snippet is really on line 2.
    const result = verifyCandidate(files, candidate({ evidence_line: 1 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidate.evidenceLine).toBe(2);
  });

  it('drops an empty rule', () => {
    const files = filesMap(sampleFile);
    expect(verifyCandidate(files, candidate({ rule: '   ' }))).toEqual({
      ok: false,
      reason: 'empty_rule',
    });
  });
});

describe('ruleKey / dedupeCandidates', () => {
  function verified(overrides: Partial<VerifiedCandidate> = {}): VerifiedCandidate {
    return {
      category: 'errors',
      rule: 'Always use async/await instead of .then() chains.',
      rationale: null,
      evidencePath: 'src/api/users.ts',
      evidenceLine: 23,
      evidenceSnippet: 'const user = await db.users.find(id);',
      confidence: 0.9,
      ...overrides,
    };
  }

  it('keys on evidence location + category, not rule text — an edited rule keeps its identity', () => {
    // Same category/evidence, totally different wording: still the same key,
    // so re-scan can't treat a user's edit as a brand-new candidate.
    const a = ruleKey(verified({ rule: 'Always use async/await.' }));
    const b = ruleKey(verified({ rule: 'Prefer async/await for DB calls (edited by user).' }));
    expect(a).toBe(b);
  });

  it('treats a different evidence location, or a different category, as a distinct key', () => {
    const base = ruleKey(verified());
    expect(ruleKey(verified({ evidenceLine: 24 }))).not.toBe(base);
    expect(ruleKey(verified({ evidencePath: 'src/api/other.ts' }))).not.toBe(base);
    expect(ruleKey(verified({ category: 'naming' }))).not.toBe(base);
  });

  it('dedupes candidates against each other, keeping the first (highest-confidence, if pre-sorted)', () => {
    const c1 = verified({ confidence: 0.9 });
    const c2 = verified({ confidence: 0.6 }); // same rule/category/evidence
    const { kept, dropped } = dedupeCandidates([c1, c2]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.confidence).toBe(0.9);
    expect(dropped).toBe(1);
  });

  it('drops a candidate matching a previously-decided rule key', () => {
    const c = verified();
    const { kept, dropped } = dedupeCandidates([c], [ruleKey(c)]);
    expect(kept).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});

describe('buildSkillDraft', () => {
  it('groups approved rows by category and cites file:line evidence', () => {
    const rows = [
      row({ id: 'a', category: 'errors', rule: 'Use async/await.', evidencePath: 'a.ts', evidenceLine: 5 }),
      row({ id: 'b', category: 'naming', rule: 'Prefix hooks with use.', evidencePath: 'b.ts', evidenceLine: 1 }),
    ];
    const draft = buildSkillDraft(rows, { name: 'repo-conventions', existingSkillId: null });

    expect(draft.name).toBe('repo-conventions');
    expect(draft.body).toContain('# Repository Conventions');
    expect(draft.body).toContain('Use async/await.');
    expect(draft.body).toContain('`a.ts:5`');
    expect(draft.body).toContain('Prefix hooks with use.');
    expect(draft.body).toContain('`b.ts:1`');
    expect(draft.convention_ids).toEqual(['a', 'b']);
    expect(draft.existing_skill_id).toBeNull();
  });

  it('reflects an edited rule verbatim (the caller passes the already-edited row)', () => {
    const rows = [row({ rule: 'Prefer async/await for DB calls (edited by user).' })];
    const draft = buildSkillDraft(rows, { name: 'repo-conventions', existingSkillId: null });
    expect(draft.body).toContain('Prefer async/await for DB calls (edited by user).');
  });

  it('surfaces an existing skill id so the caller can offer a replace flow', () => {
    const draft = buildSkillDraft([row()], { name: 'repo-conventions', existingSkillId: 'sk-9' });
    expect(draft.existing_skill_id).toBe('sk-9');
  });
});
