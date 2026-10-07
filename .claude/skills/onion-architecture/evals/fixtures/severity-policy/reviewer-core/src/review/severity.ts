import { readFileSync } from 'node:fs';
import type { Finding, Severity } from '../index.js';

const ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

function loadFloor(): Severity {
  const fromEnv = process.env.DEVDIGEST_MIN_SEVERITY as Severity | undefined;
  if (fromEnv && ORDER.includes(fromEnv)) return fromEnv;
  try {
    const raw = JSON.parse(readFileSync('.devdigest/severity.json', 'utf8')) as { floor?: Severity };
    if (raw.floor && ORDER.includes(raw.floor)) return raw.floor;
  } catch {
    // no override file
  }
  return 'low';
}

export function applySeverityFloor(findings: Finding[]): Finding[] {
  const floor = ORDER.indexOf(loadFloor());
  return findings.filter((f) => ORDER.indexOf(f.severity) >= floor);
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
