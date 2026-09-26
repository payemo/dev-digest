import type { Agent, ConventionCandidate, FindingRecord, ReviewRecord } from '@devdigest/shared';
import {
  MAX_RATIONALE_CHARS,
  MAX_RESPONSE_CHARS,
  MAX_SUMMARY_CHARS,
} from './constants.js';
import { text, type ToolResult } from './errors.js';

/**
 * Where the token discipline lives. Pure — no fetch, no env, no clock, no SDK
 * import — so its tests need no mocks.
 *
 * The rule every projection follows: build the output by ALLOWLIST (pick the
 * fields we want), never by removing the fields we don't. A contract that
 * grows a new field must not be able to leak it into a model's context.
 */

export type ResponseFormat = 'concise' | 'detailed';

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export interface Page<T> {
  page: T[];
  total: number;
  nextOffset: number | null;
}

export function paginate<T>(items: T[], limit: number, offset: number): Page<T> {
  const start = Math.max(0, offset);
  const page = items.slice(start, start + limit);
  const consumed = start + page.length;
  return { page, total: items.length, nextOffset: consumed < items.length ? consumed : null };
}

/** Names the exact next call, so a truncated list is never a dead end. */
export function truncationFooter<T>(p: Page<T>, tool: string, args: string): string | undefined {
  if (p.nextOffset === null) return undefined;
  const remaining = p.total - p.nextOffset;
  return `… ${remaining} more. Call ${tool} with ${args}offset=${p.nextOffset} for the rest.`;
}

/**
 * Agents, by allowlist.
 *
 * `system_prompt` is excluded from BOTH formats — it is thousands of tokens of
 * reviewer instructions and a prompt-injection surface. There is no
 * `response_format` that returns it.
 */
export function formatAgents(agents: Agent[]): { name: string; description: string; model: string; enabled: boolean }[] {
  return agents.map((a) => ({
    name: a.name,
    description: truncate(a.description ?? '', 160),
    model: a.model,
    enabled: a.enabled,
  }));
}

export interface ConciseFinding {
  severity: string;
  file: string;
  line: number;
  title: string;
}

export interface DetailedFinding extends ConciseFinding {
  category: string;
  confidence: number;
  rationale: string;
}

/**
 * Findings, by allowlist. `evidence` and `trifecta_components` are arrays of
 * objects returned by NEITHER format — they exist for the studio's UI, and a
 * model reviewing a PR has no use for them.
 */
export function formatFindings(
  findings: FindingRecord[],
  mode: ResponseFormat,
): (ConciseFinding | DetailedFinding)[] {
  return findings.map((f) => {
    const base: ConciseFinding = {
      severity: f.severity,
      file: f.file,
      line: f.start_line,
      title: f.title,
    };
    if (mode === 'concise') return base;
    return {
      ...base,
      category: f.category,
      confidence: f.confidence,
      rationale: truncate(f.rationale, MAX_RATIONALE_CHARS),
    };
  });
}

export function formatVerdict(review: ReviewRecord): {
  agent: string;
  verdict: string | null;
  score: number | null;
  summary: string | null;
} {
  return {
    agent: review.agent_name ?? 'unknown',
    verdict: review.verdict ?? null,
    score: review.score,
    summary: review.summary === null ? null : truncate(review.summary, MAX_SUMMARY_CHARS),
  };
}

/**
 * Conventions, by allowlist. `evidence_snippet` is raw repository text of
 * unbounded length and is returned by neither format.
 */
export function formatConventions(
  rows: ConventionCandidate[],
  mode: ResponseFormat,
): Record<string, unknown>[] {
  return rows.map((c) => {
    const base = { category: c.category, rule: c.rule };
    if (mode === 'concise') return base;
    return {
      ...base,
      rationale: c.rationale === null ? null : truncate(c.rationale, MAX_RATIONALE_CHARS),
      evidence: c.evidence_path === null ? null : `${c.evidence_path}:${c.evidence_line ?? '?'}`,
    };
  });
}

/** The final backstop, cutting on a line boundary where one is available. */
export function capResponse(body: string): string {
  if (body.length <= MAX_RESPONSE_CHARS) return body;
  const head = body.slice(0, MAX_RESPONSE_CHARS);
  const lastBreak = head.lastIndexOf('\n');
  const cut = lastBreak > MAX_RESPONSE_CHARS / 2 ? head.slice(0, lastBreak) : head;
  return `${cut}\n… (truncated — narrow the query with limit/offset or a severity filter)`;
}

/**
 * The single place a payload becomes an MCP result, so no tool can bypass the
 * response ceiling. Compact JSON, never pretty-printed: indentation is pure
 * token cost.
 */
export function toResult(payload: unknown): ToolResult {
  return text(capResponse(JSON.stringify(payload)));
}
