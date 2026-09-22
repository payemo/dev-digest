import { describe, it, expect } from 'vitest';
import { ExtractionSchema } from '../src/modules/conventions/prompt.js';

/**
 * Schema-boundary coverage for the extraction call: what the LLM adapter's
 * `parseWithRepair` validates a raw model response against. A malformed
 * response never reaches persistence — this is the gate that decides that.
 */

function validCandidate() {
  return {
    rule: 'Use async/await instead of .then() chains.',
    rationale: 'Keeps error handling in one style.',
    evidence_path: 'src/api/users.ts',
    evidence_line: 23,
    evidence_snippet: 'const user = await db.users.find(id);',
    category: 'errors',
    occurrences: 4,
    confidence: 0.85,
  };
}

describe('ExtractionSchema', () => {
  it('accepts a valid response', () => {
    const result = ExtractionSchema.safeParse({ candidates: [validCandidate()] });
    expect(result.success).toBe(true);
  });

  it('accepts an empty candidate list (a valid "nothing found" answer)', () => {
    const result = ExtractionSchema.safeParse({ candidates: [] });
    expect(result.success).toBe(true);
  });

  it('rejects malformed JSON shape — not an object with candidates', () => {
    const result = ExtractionSchema.safeParse('not json' as unknown);
    expect(result.success).toBe(false);
  });

  it('rejects a candidate missing category', () => {
    const { category, ...rest } = validCandidate();
    const result = ExtractionSchema.safeParse({ candidates: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a candidate missing rule', () => {
    const { rule, ...rest } = validCandidate();
    const result = ExtractionSchema.safeParse({ candidates: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a candidate missing evidence fields', () => {
    const { evidence_path, ...rest } = validCandidate();
    const result = ExtractionSchema.safeParse({ candidates: [rest] });
    expect(result.success).toBe(false);
  });

  it('rejects a non-integer line number', () => {
    const result = ExtractionSchema.safeParse({
      candidates: [{ ...validCandidate(), evidence_line: 23.5 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid category enum value', () => {
    const result = ExtractionSchema.safeParse({
      candidates: [{ ...validCandidate(), category: 'not-a-real-category' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric confidence', () => {
    const result = ExtractionSchema.safeParse({
      candidates: [{ ...validCandidate(), confidence: 'high' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unexpected top-level shape', () => {
    const result = ExtractionSchema.safeParse({ items: [validCandidate()] });
    expect(result.success).toBe(false);
  });
});
