/**
 * Pure helpers for BlastRadiusView. No `react` import — that is the test for
 * whether something belongs in this file. Deriving lives here; which hook runs
 * and which state is held is the component's job.
 */
import type { BlastCaller, BlastRadius, DownstreamImpact } from "@devdigest/shared";

export interface StatCounts {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/**
 * The stat row's four numbers.
 *
 * `symbols` counts the authoritative declaration list, not `downstream` — the
 * two can differ in principle, because `downstream` is keyed by the bare symbol
 * NAME while `changed_symbols` carries name + file.
 *
 * `endpoints`/`crons` are UNION sizes, not sums: an endpoint reachable from two
 * different changed symbols is one endpoint at risk, not two.
 */
export function statCounts(data: BlastRadius): StatCounts {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const entry of data.downstream) {
    callers += entry.callers.length;
    for (const e of entry.endpoints_affected) endpoints.add(e);
    for (const c of entry.crons_affected) crons.add(c);
  }
  return {
    symbols: data.changed_symbols.length,
    callers,
    endpoints: endpoints.size,
    crons: crons.size,
  };
}

/**
 * Which file declares a changed symbol, for the "declared in {file}" subtitle.
 *
 * FIRST match, deliberately: the response's `downstream` is keyed by the bare
 * name, so two changed symbols sharing a name in different files arrive as one
 * entry. The union of their callers is correct; attributing them to one
 * declaring file is a display simplification, not a fact — which is why a
 * caller link points at the caller's own file and never at this one.
 */
export function declaringFileOf(
  changedSymbols: BlastRadius["changed_symbols"],
  name: string,
): string | null {
  return changedSymbols.find((s) => s.name === name)?.file ?? null;
}

/** True when every changed symbol came back with no callers at all. */
export function hasNoCallers(data: BlastRadius): boolean {
  return data.downstream.every((entry) => entry.callers.length === 0);
}

export interface GraphRow {
  symbol: string;
  callers: BlastCaller[];
  endpoints: string[];
  /** How many nodes each column had to leave out to fit. */
  overflow: { callers: number; endpoints: number };
}

/**
 * The three-column graph's data, capped in both directions: `maxRows` symbols,
 * `maxPerColumn` callers and endpoints each. A symbol with no callers is not
 * drawn — there is no edge to draw it with — so `hidden` counts only the
 * DRAWABLE rows that did not fit.
 */
export function graphRows(
  data: BlastRadius,
  maxRows: number,
  maxPerColumn: number,
): { rows: GraphRow[]; hidden: number } {
  const drawable: DownstreamImpact[] = data.downstream.filter((e) => e.callers.length > 0);
  const rows = drawable.slice(0, maxRows).map((entry) => ({
    symbol: entry.symbol,
    callers: entry.callers.slice(0, maxPerColumn),
    endpoints: entry.endpoints_affected.slice(0, maxPerColumn),
    overflow: {
      callers: Math.max(0, entry.callers.length - maxPerColumn),
      endpoints: Math.max(0, entry.endpoints_affected.length - maxPerColumn),
    },
  }));
  return { rows, hidden: Math.max(0, drawable.length - rows.length) };
}

/** `src/api/public/index.ts:23` — the label on a caller link. */
export function callerLabel(caller: BlastCaller): string {
  return `${caller.file}:${caller.line}`;
}
