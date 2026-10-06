import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import type { FindingLabel } from '@devdigest/shared';
import { MAX_LABELS_PER_FINDING } from './constants.js';

export function toLabel(row: typeof t.findingLabels.$inferSelect): FindingLabel {
  return {
    id: row.id,
    finding_id: row.findingId,
    name: row.name,
    color: row.color as FindingLabel['color'],
    created_at: row.createdAt.toISOString(),
  };
}

export function labelsForFinding(findingId: string) {
  return eq(t.findingLabels.findingId, findingId);
}

export function canAddLabel(existingCount: number): boolean {
  return existingCount < MAX_LABELS_PER_FINDING;
}
