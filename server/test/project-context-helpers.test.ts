/**
 * project-context pure helpers — hermetic, plain object arguments, no mocks.
 *
 * Kinds of breakage covered:
 *   - discovery scope (FR-1/D-5): only `.devdigest/{specs,docs,insights}/**.md`
 *     classifies; repo-root and package-local Markdown is invisible;
 *   - path containment (NFR-2): a user-named document cannot escape its
 *     category folder by any of the usual spellings;
 *   - intake bounds (NFR-6): non-Markdown / oversized / empty are rejected
 *     WITH a reason;
 *   - merge semantics (FR-7/FR-9): direct order first, inherited in skill order,
 *     a both-ways document once at its direct position;
 *   - health derivation, rendering without truncation (NFR-3), fingerprinting,
 *     and the snake_case DTO mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDocument,
  safeUserPath,
  validateIntake,
  fingerprint,
  renderContextDocument,
  mergeEffectiveSet,
  deriveHealth,
  toDocumentDto,
} from '../src/modules/project-context/helpers.js';
import { MAX_DOC_BYTES, STALE_AFTER_MS } from '../src/modules/project-context/constants.js';

describe('classifyDocument — root-only discovery (FR-1, D-5)', () => {
  it('classifies files under the convention root by their category subfolder', () => {
    expect(classifyDocument('.devdigest/specs/a.md')).toEqual({
      category: 'specs',
      folder: '',
      name: 'a.md',
    });
    expect(classifyDocument('.devdigest/docs/api/v2/errors.markdown')).toEqual({
      category: 'docs',
      folder: 'api/v2',
      name: 'errors.markdown',
    });
    expect(classifyDocument('.devdigest/insights/Notes.MD')?.category).toBe('insights');
  });

  it('ignores Markdown outside the root, directly under it, in unknown categories, or non-Markdown', () => {
    expect(classifyDocument('README.md')).toBeNull();
    expect(classifyDocument('packages/x/docs/y.md')).toBeNull();
    expect(classifyDocument('.devdigest/notes.md')).toBeNull();
    expect(classifyDocument('.devdigest/random/a.md')).toBeNull();
    expect(classifyDocument('.devdigest/specs/diagram.png')).toBeNull();
    expect(classifyDocument('src/.devdigest/specs/a.md')).toBeNull();
  });
});

describe('safeUserPath — a user document stays inside its category (NFR-2)', () => {
  it('builds the stored path for a well-formed request, collapsing `.` segments', () => {
    expect(safeUserPath({ category: 'specs', folder: 'api/./v2', name: 'limits.md' })).toEqual({
      ok: true,
      path: '.devdigest/specs/api/v2/limits.md',
      folder: 'api/v2',
      name: 'limits.md',
    });
    expect(safeUserPath({ category: 'docs', folder: '', name: 'a.md' })).toMatchObject({
      ok: true,
      path: '.devdigest/docs/a.md',
    });
  });

  it('rejects every escape attempt with a reason', () => {
    const attempts = [
      { category: 'specs', folder: '..', name: 'a.md' },
      { category: 'specs', folder: '../../..', name: 'a.md' },
      { category: 'specs', folder: 'ok/../../docs', name: 'a.md' },
      { category: 'specs', folder: 'C:/Windows', name: 'a.md' },
      { category: 'specs', folder: 'a\\..\\b', name: 'a.md' },
      { category: 'specs', folder: 'a', name: 'x\0.md' },
      { category: 'specs', folder: '', name: '../escape.md' },
      { category: 'specs', folder: '', name: 'script.sh' },
      { category: 'etc', folder: '', name: 'passwd.md' },
    ];
    for (const attempt of attempts) {
      const result = safeUserPath(attempt);
      expect(result.ok, JSON.stringify(attempt)).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('confines a leading-slash folder under the category instead of treating it as absolute', () => {
    // The plan describes this as a rejection; the implementation confines it.
    // Either satisfies NFR-2 — what must never happen is `/etc/a.md`.
    expect(safeUserPath({ category: 'specs', folder: '/etc', name: 'a.md' })).toMatchObject({
      ok: true,
      path: '.devdigest/specs/etc/a.md',
    });
  });
});

describe('validateIntake — bounds with reasons (NFR-6)', () => {
  it('accepts a Markdown body within the bound and reports its byte size', () => {
    expect(
      validateIntake({ category: 'specs', folder: '', name: 'a.md', body: '# Héllo' }),
    ).toEqual({ ok: true, path: '.devdigest/specs/a.md', folder: '', name: 'a.md', sizeBytes: 8 });
  });

  it('rejects non-Markdown, empty and oversized bodies, saying why', () => {
    const nonMd = validateIntake({ category: 'specs', folder: '', name: 'a.txt', body: 'x' });
    expect(nonMd).toMatchObject({ ok: false, reason: expect.stringMatching(/markdown/i) });

    const empty = validateIntake({ category: 'specs', folder: '', name: 'a.md', body: '  \n ' });
    expect(empty).toMatchObject({ ok: false, reason: expect.stringMatching(/empty/i) });

    const big = validateIntake({
      category: 'specs',
      folder: '',
      name: 'a.md',
      body: 'x'.repeat(MAX_DOC_BYTES + 1),
    });
    expect(big).toMatchObject({ ok: false, reason: expect.stringContaining(String(MAX_DOC_BYTES)) });

    const atLimit = validateIntake({
      category: 'specs',
      folder: '',
      name: 'a.md',
      body: 'x'.repeat(MAX_DOC_BYTES),
    });
    expect(atLimit.ok).toBe(true);
  });
});

describe('fingerprint', () => {
  it('is the sha256 hex of the content — stable, and changes with the content', () => {
    // sha256("abc") — a published test vector.
    expect(fingerprint('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(fingerprint('# Doc')).toBe(fingerprint('# Doc'));
    expect(fingerprint('# Doc')).not.toBe(fingerprint('# Doc '));
  });
});

describe('renderContextDocument — path prefix, body verbatim, no truncation (NFR-3)', () => {
  it('prefixes the path and a blank line and keeps every byte of the body', () => {
    expect(renderContextDocument({ path: '.devdigest/specs/a.md', content: '# A\n\n  indented\n' })).toBe(
      '.devdigest/specs/a.md\n\n# A\n\n  indented\n',
    );
  });

  it('does not truncate a 100k-character body', () => {
    const body = `${'z'.repeat(100_000)}TAIL`;
    const out = renderContextDocument({ path: '.devdigest/docs/big.md', content: body });
    expect(out.length).toBe('.devdigest/docs/big.md\n\n'.length + 100_004);
    expect(out.endsWith('TAIL')).toBe(true);
  });
});

describe('mergeEffectiveSet — merge semantics (FR-7, FR-9)', () => {
  it('keeps direct order, appends inherited in skill order, dedupes a both-ways document at its direct position', () => {
    const merged = mergeEffectiveSet(
      ['d1', 'x', 'd2'],
      [
        ['s1a', 'x'], // skill 1 also reaches x
        ['s2a', 's1a'], // skill 2 repeats a doc skill 1 already contributed
      ],
    );
    expect(merged).toEqual([
      { documentId: 'd1', provenance: 'direct' },
      { documentId: 'x', provenance: 'both' },
      { documentId: 'd2', provenance: 'direct' },
      { documentId: 's1a', provenance: 'inherited' },
      { documentId: 's2a', provenance: 'inherited' },
    ]);
  });

  it('dropping a skill (disabled) removes only its inherited-only documents', () => {
    // Caller passes only ENABLED skills, so "disable skill 1" = omit its list.
    const merged = mergeEffectiveSet(['d1', 'x'], [['s2a']]);
    expect(merged).toEqual([
      { documentId: 'd1', provenance: 'direct' },
      { documentId: 'x', provenance: 'direct' },
      { documentId: 's2a', provenance: 'inherited' },
    ]);
  });

  it('an empty set is empty', () => {
    expect(mergeEffectiveSet([], [])).toEqual([]);
    expect(mergeEffectiveSet([], [[], []])).toEqual([]);
  });
});

describe('deriveHealth', () => {
  const now = Date.UTC(2026, 8, 29, 12, 0, 0);

  it('reports stored failures and bounds, and derives fresh/stale from elapsed time', () => {
    expect(deriveHealth(null, now)).toBe('stale');
    expect(deriveHealth({ outcome: 'ok', lastSyncedAt: null }, now)).toBe('stale');
    expect(deriveHealth({ outcome: 'failed', lastSyncedAt: new Date(now) }, now)).toBe('failed');
    expect(deriveHealth({ outcome: 'bounded', lastSyncedAt: new Date(now) }, now)).toBe('bounded');
    expect(deriveHealth({ outcome: 'ok', lastSyncedAt: new Date(now - 60_000) }, now)).toBe('fresh');
    expect(
      deriveHealth({ outcome: 'ok', lastSyncedAt: new Date(now - STALE_AFTER_MS - 1) }, now),
    ).toBe('stale');
  });
});

describe('toDocumentDto', () => {
  it('maps a row onto the snake_case wire shape without leaking the body', () => {
    const dto = toDocumentDto(
      {
        id: '11111111-1111-4111-8111-111111111111',
        workspaceId: 'ws',
        repoId: 'repo',
        path: '.devdigest/specs/a.md',
        name: 'a.md',
        folder: '',
        category: 'specs',
        origin: 'user',
        availability: 'missing',
        content: 'SECRET BODY',
        sizeBytes: 42,
        tokenCount: 7,
        fingerprint: 'abc',
        updatedAt: new Date('2026-09-29T10:00:00.000Z'),
      },
      3,
    );
    expect(dto).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      path: '.devdigest/specs/a.md',
      name: 'a.md',
      folder: '',
      category: 'specs',
      origin: 'user',
      availability: 'missing',
      size_bytes: 42,
      token_count: 7,
      fingerprint: 'abc',
      updated_at: '2026-09-29T10:00:00.000Z',
      used_by_agents: 3,
    });
  });
});
