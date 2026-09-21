/** "—" for a null rate (no data yet), otherwise "N%". Never collapses a null
 *  denominator to "0%" — see SkillStats's own doc comment on why that matters. */
export function fmtPct(pct: number | null, dash: string): string {
  return pct == null ? dash : `${pct}%`;
}
