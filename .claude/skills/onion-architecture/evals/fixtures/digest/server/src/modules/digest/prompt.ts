import type { LLMMessage } from '@devdigest/shared';
import type { PullSummaryRow } from './repository.js';

export function buildDigestMessages(system: string, pulls: PullSummaryRow[]): LLMMessage[] {
  const body = pulls
    .map((p) => `#${p.number} [${p.state}] ${p.title} (+${p.additions}/-${p.deletions})`)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: body },
  ];
}
