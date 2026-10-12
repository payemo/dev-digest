import type {
  AgentEstimate,
  DisagreementRow,
  DisagreementTake,
  Finding,
  FindingGroup,
  FindingRecord,
  MultiAgentChildStatus,
  MultiAgentColumn,
  MultiAgentRunStatus,
  Severity,
} from '@devdigest/shared';
import { sumRunCosts, type Estimator, type RunCostInputs } from '../../platform/run-cost.js';
import type { AgentRunRow, FindingRow, ReviewRow } from './repository.js';
import { NOTE_MAX_CHARS, SEVERITY_RANK } from './constants.js';

/**
 * Pure multi-agent policy: estimates, cost/status/totals, location grouping and
 * disagreements. Functions over their arguments only — no I/O, no persistence
 * layer. Grouping and disagreements are computed on read and only REFERENCE
 * findings by id; they never copy or alter one.
 */

// ---------------------------------------------------------------- estimates

/**
 * Average an agent's recent comparable runs. Duration and cost are averaged
 * independently over their own non-null values; each is null with no inputs.
 * `sample_size` is the number of runs considered (0 → "no estimate").
 */
export function averageEstimate(
  rows: { durationMs: number | null; cost: number | null }[],
): AgentEstimate {
  const durations = rows.map((r) => r.durationMs).filter((d): d is number => d != null);
  const costs = rows.map((r) => r.cost).filter((c): c is number => c != null);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    avg_duration_ms: durations.length > 0 ? Math.round(mean(durations)) : null,
    avg_cost_usd: costs.length > 0 ? Math.round(mean(costs) * 1e6) / 1e6 : null,
    sample_size: rows.length,
  };
}

// ---------------------------------------------------------------- cost / status / totals

/**
 * Cost of a FAILED or CANCELLED run. A reported cost is returned verbatim; a run
 * that actually consumed tokens is priced from them; otherwise unknown (null).
 * Unlike `effectiveRunCost`, zero tokens never derive a misleading `$0` — the
 * executor stores 0 tokens on every failure.
 */
export function failedRunCost(row: RunCostInputs, estimate: Estimator): number | null {
  if (row.costUsd != null) return row.costUsd;
  if ((row.tokensIn ?? 0) + (row.tokensOut ?? 0) <= 0) return null;
  if (!row.model) return null;
  return estimate(row.model, row.tokensIn ?? 0, row.tokensOut ?? 0);
}

/**
 * Parent status from its children: running while any child runs; done when all
 * are done; failed when none is done; otherwise partial.
 */
export function deriveParentStatus(statuses: MultiAgentChildStatus[]): MultiAgentRunStatus {
  if (statuses.some((s) => s === 'running')) return 'running';
  const done = statuses.filter((s) => s === 'done').length;
  if (statuses.length > 0 && done === statuses.length) return 'done';
  if (done === 0) return 'failed';
  return 'partial';
}

/**
 * Totals for the results header. Duration is the slowest known child (they run
 * in parallel). Cost counts `done` children only; failed/cancelled cost is kept
 * separate and is null when none is known.
 */
export function computeTotals(
  columns: Pick<MultiAgentColumn, 'status' | 'duration_ms' | 'cost_usd'>[],
  failedCosts: (number | null)[],
): {
  agent_count: number;
  total_duration_ms: number | null;
  total_cost_usd: number | null;
  failed_cost_usd: number | null;
} {
  const durations = columns.map((c) => c.duration_ms).filter((d): d is number => d != null);
  const done = columns.filter((c) => c.status === 'done');
  // Column costs are already effective (reported or derived), so the estimator
  // here is never consulted; sumRunCosts supplies the rounding + empty → null.
  const total = sumRunCosts(
    done.map((c) => ({ costUsd: c.cost_usd ?? 0, model: null, tokensIn: null, tokensOut: null })),
    () => null,
  );
  const known = failedCosts.filter((c): c is number => c != null);
  return {
    agent_count: columns.length,
    total_duration_ms: durations.length > 0 ? Math.max(...durations) : null,
    total_cost_usd: total,
    failed_cost_usd:
      known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null,
  };
}

// ---------------------------------------------------------------- DTO mapping

/** A persisted finding row as the wire `FindingRecord` (snake_case). */
export function findingRowToRecord(row: FindingRow): FindingRecord {
  return {
    id: row.id,
    severity: row.severity as Finding['severity'],
    category: row.category as Finding['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    confidence: row.confidence,
    kind: (row.kind as Finding['kind']) ?? 'finding',
    trifecta_components: (row.trifectaComponents as Finding['trifecta_components']) ?? null,
    evidence: null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
  };
}

/** One child run (+ its review and findings, when done) as a results column. */
export function childToColumn(
  run: AgentRunRow,
  agentName: string | null,
  review: ReviewRow | undefined,
  findings: FindingRow[],
  costUsd: number | null,
): MultiAgentColumn {
  return {
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    verdict: (review?.verdict as MultiAgentColumn['verdict']) ?? null,
    score: run.score ?? review?.score ?? null,
    summary: review?.summary ?? null,
    duration_ms: run.status === 'running' ? null : run.durationMs,
    cost_usd: costUsd,
    findings: run.status === 'done' ? findings.map(findingRowToRecord) : [],
  };
}

// ---------------------------------------------------------------- grouping

type Located = {
  col: number;
  run_id: string;
  agent_id: string | null;
  finding: FindingRecord;
};

const rank = (s: Severity) => SEVERITY_RANK[s] ?? 0;

/**
 * Group findings across columns by physical location only: same file and
 * overlapping (inclusive) line ranges. Category and text are ignored, and there
 * is no tolerance — lines 52 and 53 stay apart unless one range covers both.
 * Extending a group's end makes the merge transitive.
 */
export function groupFindings(
  columns: Pick<MultiAgentColumn, 'run_id' | 'agent_id' | 'findings'>[],
): FindingGroup[] {
  const byFile = new Map<string, Located[]>();
  columns.forEach((c, col) => {
    for (const f of c.findings) {
      const list = byFile.get(f.file) ?? [];
      list.push({ col, run_id: c.run_id, agent_id: c.agent_id, finding: f });
      byFile.set(f.file, list);
    }
  });

  const groups: FindingGroup[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const items = byFile
      .get(file)!
      .slice()
      .sort((a, b) => a.finding.start_line - b.finding.start_line || a.col - b.col);
    let current: { start: number; end: number; items: Located[] } | null = null;
    const flush = () => {
      if (current) groups.push(toGroup(file, current.start, current.end, current.items));
    };
    for (const it of items) {
      const end = Math.max(it.finding.start_line, it.finding.end_line);
      if (current && it.finding.start_line <= current.end) {
        current.end = Math.max(current.end, end);
        current.items.push(it);
      } else {
        flush();
        current = { start: it.finding.start_line, end, items: [it] };
      }
    }
    flush();
  }
  return groups;
}

function toGroup(file: string, start: number, end: number, items: Located[]): FindingGroup {
  const head = items
    .slice()
    .sort(
      (a, b) =>
        rank(b.finding.severity) - rank(a.finding.severity) ||
        a.finding.start_line - b.finding.start_line ||
        a.col - b.col,
    )[0]!;
  return {
    id: `${file}:${start}-${end}`,
    file,
    start_line: start,
    end_line: end,
    title: head.finding.title,
    members: items.map((i) => ({ run_id: i.run_id, agent_id: i.agent_id, finding_id: i.finding.id })),
  };
}

// ---------------------------------------------------------------- disagreements

/** First sentence of a (markdown) rationale as short plain text. */
export function noteFromRationale(rationale: string): string {
  const plain = rationale
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_>#]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const m = plain.match(/^.*?[.!?](?=\s|$)/);
  const sentence = (m ? m[0] : plain).trim();
  return sentence.length > NOTE_MAX_CHARS
    ? `${sentence.slice(0, NOTE_MAX_CHARS - 1).trimEnd()}…`
    : sentence;
}

/**
 * For every location group, one take per column of THIS parent:
 * running → pending; failed/cancelled → no_result (never "did not flag");
 * done with a member → flagged (highest severity, first-sentence note);
 * done without → did_not_flag (no note — the client shows one fixed string).
 *
 * A row is a conflict when, among done columns, someone flagged and someone
 * did not, or the flaggers' highest severities differ. Empty with fewer than 2
 * columns or no done column.
 */
export function buildDisagreements(
  columns: Pick<MultiAgentColumn, 'run_id' | 'agent_id' | 'status' | 'findings'>[],
  groups: FindingGroup[],
): DisagreementRow[] {
  if (columns.length < 2) return [];
  if (!columns.some((c) => c.status === 'done')) return [];

  const findingById = new Map<string, FindingRecord>();
  for (const c of columns) for (const f of c.findings) findingById.set(f.id, f);

  return groups.map((g) => {
    const takes: DisagreementTake[] = columns.map((c) => {
      const base = { run_id: c.run_id, agent_id: c.agent_id };
      if (c.status === 'running') return { kind: 'pending', ...base };
      if (c.status !== 'done') return { kind: 'no_result', ...base };
      const mine = g.members
        .filter((m) => m.run_id === c.run_id)
        .map((m) => findingById.get(m.finding_id))
        .filter((f): f is FindingRecord => f != null);
      if (mine.length === 0) return { kind: 'did_not_flag', ...base };
      const top = mine.slice().sort((a, b) => rank(b.severity) - rank(a.severity))[0]!;
      return {
        kind: 'flagged',
        ...base,
        severity: top.severity,
        note: noteFromRationale(top.rationale),
        finding_ids: mine.map((f) => f.id),
      };
    });

    const flagged = takes.filter((t) => t.kind === 'flagged');
    const didNot = takes.filter((t) => t.kind === 'did_not_flag');
    const severities = new Set(flagged.map((t) => (t.kind === 'flagged' ? t.severity : null)));
    const conflict = (flagged.length > 0 && didNot.length > 0) || severities.size > 1;

    return {
      group_id: g.id,
      file: g.file,
      line: g.start_line,
      title: g.title,
      conflict,
      takes,
    };
  });
}
