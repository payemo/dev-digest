import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import {
  Agent,
  Conformance,
  Provider,
  CiFailOn,
  EvalCase,
  EvalCaseStatus,
  EvalExpectationKind,
  EvalExpectedFinding,
  EvalInputFile,
  EvalLocation,
  EvalPrMeta,
  EvalRunStatus,
  EvalSkillSnapshotEntry,
  EvalSourceDecision,
} from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * The base eval shapes (`EvalCase`, `EvalExpectedFinding`, `EvalLocation`,
 * `EvalSkillSnapshotEntry`, …) live in `knowledge.ts`; here are the
 * *API-facing* request/response shapes: case input/seed/record, per-case
 * results (`eval_runs`), agent-wide runs (`eval_agent_runs`), the per-agent
 * detail + workspace dashboard aggregates, compare and promote. Also the
 * compose / CI / conformance records.
 */

// ===========================================================================
// Eval — cases
// ===========================================================================

/** A metric in `[0,1]`, or `null` = not applicable (zero denominator). */
const EvalMetric = z.number().min(0).max(1).nullable();

/**
 * Create/update payload for an agent-owned eval case. The owner comes from the
 * route. Kind rules: `must_find` needs ≥ 1 expected finding and no forbidden
 * location; `must_not_flag` needs an empty expected output.
 */
export const EvalCaseInput = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    kind: EvalExpectationKind,
    input_diff: z.string().min(1, 'A diff is required'),
    input_files: z.array(EvalInputFile).default([]),
    input_meta: EvalPrMeta,
    expected_output: z.array(EvalExpectedFinding),
    forbidden_location: EvalLocation.nullish(),
    notes: z.string().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'must_find') {
      if (v.expected_output.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expected_output'],
          message: 'A must_find case needs at least one expected finding',
        });
      }
      if (v.forbidden_location) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['forbidden_location'],
          message: 'A must_find case has no forbidden location',
        });
      }
    } else if (v.expected_output.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expected_output'],
        message: 'A must_not_flag case must have an empty expected output',
      });
    }
  });
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type EvalCaseInputBody = z.input<typeof EvalCaseInput>;

/** Overrides for `POST /findings/:id/eval-case`. The input is always re-frozen server-side. */
export const EvalCaseFromFindingInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().optional(),
  expected_output: z.array(EvalExpectedFinding).optional(),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

/** One case execution's result — a row of a full run, or a single-case run (`suite_run_id` null). */
export const EvalCaseResult = z.object({
  id: z.string(),
  case_id: z.string().nullable(),
  case_name: z.string(),
  case_kind: EvalExpectationKind,
  suite_run_id: z.string().nullable(),
  agent_version: z.number().int(),
  status: EvalCaseStatus,
  reason: z.string().nullable(),
  emitted: z.number().int(),
  grounded: z.number().int(),
  expected_n: z.number().int(),
  got_m: z.number().int(),
  /** Indexes into the case's `expected_output` that were matched. */
  matched: z.array(z.number().int()),
  findings: z.array(Finding),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  ran_at: z.string(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/** A case as listed in the Evals tab: the case + its last result + whether its source finding still exists. */
export const EvalCaseRecord = EvalCase.extend({
  last_result: EvalCaseResult.nullable(),
  source_available: z.boolean(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/** `GET /findings/:id/eval-case` — the seeded draft, or the case already made from this finding. */
export const EvalCaseSeed = z.object({
  decision: EvalSourceDecision,
  existing: EvalCaseRecord.nullable(),
  draft: EvalCaseInput,
});
export type EvalCaseSeed = z.infer<typeof EvalCaseSeed>;

// ===========================================================================
// Eval — runs
// ===========================================================================

/** Wire form of a pinned skill — the rendered prompt text stays server-side. */
export const EvalSkillSnapshotItem = EvalSkillSnapshotEntry.omit({ rendered: true });
export type EvalSkillSnapshotItem = z.infer<typeof EvalSkillSnapshotItem>;

/** An agent-wide eval run, pinned to an agent version + skill snapshot + case set. */
export const EvalAgentRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  provider: z.string().nullable(),
  model: z.string(),
  status: EvalRunStatus,
  skill_snapshot: z.array(EvalSkillSnapshotItem),
  case_ids: z.array(z.string()),
  cases_total: z.number().int(),
  cases_done: z.number().int(),
  passed: z.number().int(),
  errored: z.number().int(),
  recall: EvalMetric,
  precision: EvalMetric,
  citation_accuracy: EvalMetric,
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});
export type EvalAgentRun = z.infer<typeof EvalAgentRun>;

export const EvalAgentRunDetail = EvalAgentRun.extend({
  results: z.array(EvalCaseResult),
});
export type EvalAgentRunDetail = z.infer<typeof EvalAgentRunDetail>;

/** `POST /agents/:id/eval/runs` — the started run, or the in-flight one re-attached to. */
export const EvalStartResult = z.object({
  run: EvalAgentRun,
  attached: z.boolean(),
});
export type EvalStartResult = z.infer<typeof EvalStartResult>;

export const EvalRunAllResult = z.object({
  runs: z.array(EvalStartResult),
});
export type EvalRunAllResult = z.infer<typeof EvalRunAllResult>;

// ===========================================================================
// Eval — detail, dashboard
// ===========================================================================

export const EvalMetricTriple = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export type EvalMetricTriple = z.infer<typeof EvalMetricTriple>;

/** One point on a trend (one completed run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  version: z.number().int(),
  recall: EvalMetric,
  precision: EvalMetric,
  citation_accuracy: EvalMetric,
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Structured "Precision dipped N pts on vX" alert. */
export const EvalPrecisionDip = z.object({
  points: z.number().int(),
  version: z.number().int(),
  recall_delta: z.number().nullable(),
  citation_delta: z.number().nullable(),
});
export type EvalPrecisionDip = z.infer<typeof EvalPrecisionDip>;

/** `GET /agents/:id/eval/detail` — the per-agent eval page. */
export const EvalAgentDetail = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  runs_in_window: z.number().int(),
  window_days: z.number().int(),
  latest: EvalAgentRun.nullable(),
  delta: EvalMetricTriple,
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalAgentRun),
  in_flight: EvalAgentRun.nullable(),
  alert: EvalPrecisionDip.nullable(),
});
export type EvalAgentDetail = z.infer<typeof EvalAgentDetail>;

/** One dashboard row: an agent with ≥ 1 case. */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  model: z.string(),
  cases_total: z.number().int(),
  latest: EvalAgentRun.nullable(),
  recall_series: z.array(z.number()),
  in_flight: z.boolean(),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

export const EvalWorkspaceRun = EvalAgentRun.extend({ agent_name: z.string() });
export type EvalWorkspaceRun = z.infer<typeof EvalWorkspaceRun>;

/** `GET /eval/dashboard` — every agent with cases + recent runs across agents. */
export const EvalWorkspaceDashboard = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalWorkspaceRun),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;

// ===========================================================================
// Eval — compare, promote
// ===========================================================================

export const EvalSkillDiff = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  reordered: z.boolean(),
  changed: z.array(
    z.object({
      name: z.string(),
      from_version: z.number().int(),
      to_version: z.number().int(),
    }),
  ),
});
export type EvalSkillDiff = z.infer<typeof EvalSkillDiff>;

/** `GET /eval/compare?a=&b=` — two runs of one agent, ordered older → newer. */
export const EvalCompare = z.object({
  old: EvalAgentRun,
  new: EvalAgentRun,
  delta: EvalMetricTriple.extend({ cost_usd: z.number().nullable() }),
  old_prompt: z.string(),
  new_prompt: z.string(),
  same_prompt: z.boolean(),
  model_change: z.object({ from: z.string(), to: z.string() }).nullable(),
  skill_diff: EvalSkillDiff,
  no_config_change: z.boolean(),
  case_set: z.object({
    same: z.boolean(),
    only_old: z.number().int(),
    only_new: z.number().int(),
  }),
  promote: z.object({
    version: z.number().int(),
    available: z.boolean(),
    skill_mismatch: z.boolean(),
  }),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

export const EvalPromoteInput = z.object({
  run_id: z.string().uuid(),
});
export type EvalPromoteInput = z.infer<typeof EvalPromoteInput>;

export const EvalPromoteResult = z.object({
  agent: Agent,
  new_version: z.number().int(),
  source_version: z.number().int(),
  skill_mismatch: z.boolean(),
});
export type EvalPromoteResult = z.infer<typeof EvalPromoteResult>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
