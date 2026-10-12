import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadMemory, MAX_MEMORY_ITEMS } from './memory.js';

/**
 * `.devdigest/memory.jsonl` — exported by the studio, read in CI. Breakage
 * covered: a repo without the file failing the review, one corrupt line
 * failing the whole review, and an oversized file flooding the prompt.
 */

const item = (content: string, o: object = {}) =>
  JSON.stringify({ content, scope: 'global', kind: 'convention', confidence: 0.8, sources: [], ...o });

describe('loadMemory', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'devdigest-runner-memory-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('yields no memory when the file is missing', () => {
    expect(loadMemory(dir)).toEqual({ items: [], skipped: 0 });
  });

  it('keeps valid items in file order and skips (and counts) invalid lines', () => {
    writeFileSync(
      path.join(dir, 'memory.jsonl'),
      [
        item('first'),
        '{not json',
        '',
        item('wrong kind', { kind: 'gossip' }),
        JSON.stringify({ content: 'no scope' }),
        '   ',
        item('second'),
      ].join('\n') + '\n',
    );
    expect(loadMemory(dir)).toEqual({ items: ['first', 'second'], skipped: 3 });
  });

  it(`caps the items at ${MAX_MEMORY_ITEMS}`, () => {
    const lines = Array.from({ length: MAX_MEMORY_ITEMS + 25 }, (_, i) => item(`m${i}`));
    writeFileSync(path.join(dir, 'memory.jsonl'), lines.join('\n'));
    const { items, skipped } = loadMemory(dir);
    expect(items).toHaveLength(MAX_MEMORY_ITEMS);
    expect(items[0]).toBe('m0');
    expect(items.at(-1)).toBe(`m${MAX_MEMORY_ITEMS - 1}`);
    expect(skipped).toBe(0);
  });
});
