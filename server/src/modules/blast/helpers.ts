/**
 * Blast Radius (L04) — pure transforms. A `BlastResult` in, a wire response
 * out: no wiring, no data access, no HTTP, no model call, no clock and no
 * randomness, so the same input always produces byte-identical output. That is
 * what makes the mapping table in `test/blast-helpers.test.ts` assertable
 * without a single mock.
 *
 * The camelCase → snake_case rename to the wire contract happens HERE, on the
 * way out, and by ALLOWLIST: a field added to `BlastChangedSymbol` or
 * `BlastCallerRow` later cannot leak onto a response by being spread.
 */
import type { BlastResult } from '../repo-intel/types.js';
import type { BlastRadiusResponse } from '@devdigest/shared';

type Downstream = BlastRadiusResponse['downstream'][number];

/** `symbol name -> the files that declare it in this PR`. */
function declaringFiles(result: BlastResult): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const s of result.changedSymbols) {
    const files = byName.get(s.name);
    if (files) files.add(s.file);
    else byName.set(s.name, new Set([s.file]));
  }
  return byName;
}

/**
 * A caller whose file DECLARES the symbol it references is not downstream
 * impact — it is the symbol's own file calling itself.
 *
 * The facade drops those with an explicit filter on the ripgrep path, and only
 * as a consequence of import-graph resolution on the persistent one (a
 * reference resolves to a file only when the referencing file imports it, and
 * a file does not import itself). That second one is a property of the
 * resolver, not an assertion anyone wrote down — hence the defensive filter.
 *
 * The predicate is precise: only the declaring files OF THAT SAME NAME
 * disqualify a caller. A caller living in another file this PR also changed is
 * a real caller and is kept.
 */
function isSelfFileCaller(
  callerFile: string,
  viaSymbol: string,
  declared: Map<string, Set<string>>,
): boolean {
  return declared.get(viaSymbol)?.has(callerFile) ?? false;
}

/** Deduped, ascending — so the output is stable whatever order callers arrive in. */
function sortedUnion(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * One `downstream` entry per unique changed-symbol NAME, INCLUDING names with
 * no callers at all: the card renders a row per changed symbol, so an ordered
 * response list is one render loop instead of a client-side join over two
 * arrays plus an invented order for the remainder.
 *
 * Known limitation: two changed symbols sharing a name in different files
 * collapse into one entry, because the contract keys on the bare name. The
 * union of their callers is correct; the attribution to a single declaring file
 * is not.
 */
function groupDownstream(result: BlastResult): { entries: Downstream[]; callerFiles: Set<string> } {
  const declared = declaringFiles(result);

  const callersByName = new Map<string, Downstream['callers']>();
  const filesByName = new Map<string, Set<string>>();
  const maxRankByName = new Map<string, number>();
  const allCallerFiles = new Set<string>();
  const seen = new Set<string>();

  // `result.callers` already arrives rank-descending on the persistent path;
  // that order is preserved inside each group rather than re-derived.
  for (const row of result.callers) {
    if (!declared.has(row.viaSymbol)) continue;
    if (isSelfFileCaller(row.file, row.viaSymbol, declared)) continue;

    const key = `${row.file}|${row.symbol}|${row.line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const callers = callersByName.get(row.viaSymbol);
    if (callers) callers.push({ name: row.symbol, file: row.file, line: row.line });
    else callersByName.set(row.viaSymbol, [{ name: row.symbol, file: row.file, line: row.line }]);

    const files = filesByName.get(row.viaSymbol);
    if (files) files.add(row.file);
    else filesByName.set(row.viaSymbol, new Set([row.file]));

    allCallerFiles.add(row.file);
    maxRankByName.set(row.viaSymbol, Math.max(maxRankByName.get(row.viaSymbol) ?? 0, row.rank));
  }

  const entries: Downstream[] = [];
  for (const name of declared.keys()) {
    const files = filesByName.get(name) ?? new Set<string>();
    const endpoints: string[] = [];
    const crons: string[] = [];
    // Per-symbol facts come ONLY from `factsByFile`. The flat
    // `impactedEndpoints` is a repo-wide union with no per-file attribution, so
    // pinning it on a particular symbol would assert a dependency the data does
    // not support. When `factsByFile` is absent (the degraded path) every entry
    // is legitimately empty, and the degraded flag is what explains the gap.
    for (const file of files) {
      const facts = result.factsByFile?.[file];
      if (!facts) continue;
      endpoints.push(...facts.endpoints);
      crons.push(...facts.crons);
    }
    entries.push({
      symbol: name,
      callers: callersByName.get(name) ?? [],
      endpoints_affected: sortedUnion(endpoints),
      crons_affected: sortedUnion(crons),
    });
  }

  entries.sort((a, b) => {
    const rank = (maxRankByName.get(b.symbol) ?? 0) - (maxRankByName.get(a.symbol) ?? 0);
    if (rank !== 0) return rank;
    const count = b.callers.length - a.callers.length;
    if (count !== 0) return count;
    return a.symbol.localeCompare(b.symbol);
  });

  return { entries, callerFiles: allCallerFiles };
}

/**
 * Deterministic interpolation over the counts — this is an API field that MCP
 * consumes, not UI copy (the card renders its own labels from its i18n
 * namespace and never displays this).
 */
function buildSummary(
  counts: { symbols: number; callers: number; files: number; endpoints: number; crons: number },
  degraded: boolean,
  reason: string,
): string {
  const base =
    `${counts.symbols} changed symbol(s), ${counts.callers} caller(s) in ` +
    `${counts.files} file(s), ${counts.endpoints} endpoint(s), ${counts.crons} cron(s).`;
  if (!degraded) return base;
  const tail =
    counts.symbols === 0
      ? 'no call graph available.'
      : 'results may be missing callers.';
  return `${base} Index incomplete (${reason}) — ${tail}`;
}

/** repo-intel's `BlastResult` → the `GET /pulls/:id/blast` response body. */
export function toBlastRadiusResponse(result: BlastResult): BlastRadiusResponse {
  const { entries, callerFiles } = groupDownstream(result);

  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const entry of entries) {
    callers += entry.callers.length;
    for (const e of entry.endpoints_affected) endpoints.add(e);
    for (const c of entry.crons_affected) crons.add(c);
  }

  const degraded = result.degraded === true;

  return {
    changed_symbols: result.changedSymbols.map((s) => ({
      name: s.name,
      file: s.file,
      kind: s.kind,
    })),
    downstream: entries,
    summary: buildSummary(
      {
        symbols: result.changedSymbols.length,
        callers,
        files: callerFiles.size,
        endpoints: endpoints.size,
        crons: crons.size,
      },
      degraded,
      result.reason ?? 'unknown',
    ),
    // Both keys are absent unless the facade actually degraded, so a healthy
    // response carries no noise for the client to branch on.
    ...(degraded ? { degraded: true, reason: result.reason ?? 'unknown' } : {}),
  };
}
