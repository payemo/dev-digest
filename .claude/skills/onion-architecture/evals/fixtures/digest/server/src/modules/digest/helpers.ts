import type { Digest, DigestModelOutput } from '@devdigest/shared';
import type { DigestRow, PullSummaryRow } from './repository.js';
import { DIGEST_MAX_PULLS } from './constants.js';

export function selectPulls(pulls: PullSummaryRow[]): PullSummaryRow[] {
  return [...pulls]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, DIGEST_MAX_PULLS);
}

export function toDigest(row: DigestRow): Digest {
  return {
    id: row.id,
    period_start: row.periodStart.toISOString(),
    period_end: row.periodEnd.toISOString(),
    headline: row.headline,
    items: row.items as Digest['items'],
    created_at: row.createdAt.toISOString(),
  };
}

export function renderMessage(output: DigestModelOutput): string {
  const lines = output.items.map((i) => `• #${i.pull_number} ${i.summary}`);
  return [output.headline, '', ...lines].join('\n');
}
