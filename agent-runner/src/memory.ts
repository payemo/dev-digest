import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MemoryItem } from '@devdigest/shared';

/** Upper bound on memory items handed to the prompt (the studio exports ≤ 200 too). */
export const MAX_MEMORY_ITEMS = 200;

export interface LoadedMemory {
  /** `content` of each valid item, in file order, capped at MAX_MEMORY_ITEMS. */
  items: string[];
  /** Non-empty lines that were not valid JSON / not a valid `MemoryItem`. */
  skipped: number;
}

/**
 * Reads `.devdigest/memory.jsonl` (exported by the studio: one `MemoryItem`
 * JSON object per line). A missing file is not an error — it yields no
 * memory. Each line is validated with the shared `MemoryItem` schema; invalid
 * lines are skipped and counted rather than failing the review. The content
 * reaches the prompt through `reviewPullRequest`'s `memory` slot, like a
 * studio run's curated memory.
 */
export function loadMemory(
  devdigestDir: string,
  readFile: typeof readFileSync = readFileSync,
): LoadedMemory {
  let raw: string;
  try {
    raw = readFile(path.join(devdigestDir, 'memory.jsonl'), 'utf8') as unknown as string;
  } catch {
    return { items: [], skipped: 0 };
  }
  const items: string[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const result = MemoryItem.safeParse(parsed);
    if (!result.success) {
      skipped++;
      continue;
    }
    if (items.length < MAX_MEMORY_ITEMS) items.push(result.data.content);
  }
  return { items, skipped };
}
