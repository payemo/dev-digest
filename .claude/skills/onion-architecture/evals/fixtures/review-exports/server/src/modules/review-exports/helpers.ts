import type { ReviewExport } from '@devdigest/shared';
import type { FindingRow } from '../../db/rows.js';

export function toCsv(rows: FindingRow[]): string {
  const header = 'id,severity,file,line,title';
  const lines = rows.map((r) => [r.id, r.severity, r.file, r.line, JSON.stringify(r.title)].join(','));
  return [header, ...lines].join('\n');
}

export function toExport(format: 'csv' | 'json', rows: FindingRow[]): ReviewExport {
  return {
    format,
    count: rows.length,
    content: format === 'csv' ? toCsv(rows) : JSON.stringify(rows),
  };
}
