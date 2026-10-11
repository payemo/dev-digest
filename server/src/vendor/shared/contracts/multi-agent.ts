import { z } from 'zod';
import { Severity, Verdict } from './findings.js';
import { FindingRecord } from './review-api.js';

/**
 * Multi-Agent Review contracts — one parent `multi_agent_runs` row with N
 * concurrent child `agent_runs`, read back as a single view.
 *
 * Supersedes the unused shapes in `contracts/observability.ts` (`MultiAgentRun`,
 * `AgentColumn`, `Conflict`, `ConflictTake`), which stay for compatibility.
 *
 * Grouping (`groups`) and disagreements are computed on read and never stored;
 * a group/take only REFERENCES findings by id, it never copies or alters them.
 */

/** Overall status of a parent run, derived from its children. */
export const MultiAgentRunStatus = z.enum(['running', 'done', 'partial', 'failed']);
export type MultiAgentRunStatus = z.infer<typeof MultiAgentRunStatus>;

/** Status of one child run (mirrors `agent_runs.status`). */
export const MultiAgentChildStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type MultiAgentChildStatus = z.infer<typeof MultiAgentChildStatus>;

/**
 * Per-agent time/cost estimate averaged over its recent successful local runs
 * on its current model. `sample_size: 0` means "no estimate".
 */
export const AgentEstimate = z.object({
  avg_duration_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  sample_size: z.number().int(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/** An enabled agent offered in the picker / Configure run screen. */
export const MultiAgentCandidate = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string(),
  model: z.string(),
  description: z.string(),
  /** Newest review summary by this agent on the PR — untrusted LLM text. */
  latest_summary: z.string().nullable(),
  estimate: AgentEstimate,
});
export type MultiAgentCandidate = z.infer<typeof MultiAgentCandidate>;

/** One child run of a parent, as a results column. */
export const MultiAgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: MultiAgentChildStatus,
  error: z.string().nullable(),
  verdict: Verdict.nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(FindingRecord),
});
export type MultiAgentColumn = z.infer<typeof MultiAgentColumn>;

/** A reference to one finding inside a location group. */
export const FindingGroupMember = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  finding_id: z.string(),
});
export type FindingGroupMember = z.infer<typeof FindingGroupMember>;

/** Findings across columns whose line ranges overlap in the same file. */
export const FindingGroup = z.object({
  id: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  members: z.array(FindingGroupMember),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/**
 * One column's take on a location group. `did_not_flag` deliberately carries
 * no note — the client renders one fixed generic string for it.
 */
export const DisagreementTake = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('flagged'),
    run_id: z.string(),
    agent_id: z.string().nullable(),
    severity: Severity,
    note: z.string(),
    finding_ids: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('did_not_flag'),
    run_id: z.string(),
    agent_id: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('no_result'),
    run_id: z.string(),
    agent_id: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('pending'),
    run_id: z.string(),
    agent_id: z.string().nullable(),
  }),
]);
export type DisagreementTake = z.infer<typeof DisagreementTake>;

export const DisagreementRow = z.object({
  group_id: z.string(),
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  conflict: z.boolean(),
  takes: z.array(DisagreementTake),
});
export type DisagreementRow = z.infer<typeof DisagreementRow>;

/** `GET /pulls/:id/multi-agent/latest` — the PR's latest parent run. */
export const MultiAgentRunView = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  pr_title: z.string(),
  repo_id: z.string(),
  ran_at: z.string(),
  status: MultiAgentRunStatus,
  agent_count: z.number().int(),
  total_duration_ms: z.number().int().nullable(),
  /** Successful (done) children only. */
  total_cost_usd: z.number().nullable(),
  /** Failed/cancelled children with a known cost; null when none is known. */
  failed_cost_usd: z.number().nullable(),
  columns: z.array(MultiAgentColumn),
  groups: z.array(FindingGroup),
  disagreements: z.array(DisagreementRow),
});
export type MultiAgentRunView = z.infer<typeof MultiAgentRunView>;

/** `GET /repos/:id/multi-agent/latest` — pointer to the repo's latest parent. */
export const MultiAgentRunRef = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  ran_at: z.string(),
});
export type MultiAgentRunRef = z.infer<typeof MultiAgentRunRef>;
