import { z } from 'zod';
import { Severity, FindingCategory } from './findings.js';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

/** A metric in `[0,1]`, or `null` when its denominator is zero ("not applicable"). */
const EvalMetric = z.number().min(0).max(1).nullable();

export const EvalRun = z.object({
  recall: EvalMetric,
  precision: EvalMetric,
  citation_accuracy: EvalMetric,
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

/** `must_find` = seeded from an accepted finding; `must_not_flag` = from a dismissed one. */
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/** The decision a seeded case was frozen from. */
export const EvalSourceDecision = z.enum(['accepted', 'dismissed']);
export type EvalSourceDecision = z.infer<typeof EvalSourceDecision>;

/**
 * One expected finding of a `must_find` case. Matched mechanically: equal file
 * path + intersecting inclusive line range (`end_line` absent = `[start, start]`).
 */
export const EvalExpectedFinding = z
  .object({
    severity: Severity,
    category: FindingCategory,
    title: z.string().min(1),
    file: z.string().min(1),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1).optional(),
  })
  .refine((e) => e.end_line === undefined || e.end_line >= e.start_line, {
    message: 'end_line must be ≥ start_line',
    path: ['end_line'],
  });
export type EvalExpectedFinding = z.infer<typeof EvalExpectedFinding>;

/** A file + inclusive line range (the forbidden location of a `must_not_flag` case). */
export const EvalLocation = z
  .object({
    file: z.string().min(1),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
  })
  .refine((l) => l.end_line >= l.start_line, {
    message: 'end_line must be ≥ start_line',
    path: ['end_line'],
  });
export type EvalLocation = z.infer<typeof EvalLocation>;

/** Frozen PR meta of a case — reaches the model as the task line + description. */
export const EvalPrMeta = z.object({
  number: z.number().int().nullish(),
  title: z.string(),
  description: z.string().nullish(),
  author: z.string().nullish(),
});
export type EvalPrMeta = z.infer<typeof EvalPrMeta>;

/** A reference-only file entry — never sent to the agent. */
export const EvalInputFile = z.object({
  path: z.string(),
  note: z.string().nullish(),
});
export type EvalInputFile = z.infer<typeof EvalInputFile>;

/**
 * One linked skill as pinned by an eval run, in link order. `content_hash`
 * covers the rendered prompt block (name + description + body), so a
 * description edit that leaves `version` unchanged is still detected.
 * `rendered` is server-only; wire shapes omit it.
 */
export const EvalSkillSnapshotEntry = z.object({
  skill_id: z.string(),
  name: z.string(),
  version: z.number().int(),
  enabled: z.boolean(),
  order: z.number().int(),
  content_hash: z.string(),
  rendered: z.string(),
});
export type EvalSkillSnapshotEntry = z.infer<typeof EvalSkillSnapshotEntry>;

export const EvalCaseStatus = z.enum(['passed', 'failed', 'errored']);
export type EvalCaseStatus = z.infer<typeof EvalCaseStatus>;

export const EvalRunStatus = z.enum(['running', 'completed', 'failed']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  kind: EvalExpectationKind,
  input_diff: z.string(),
  input_files: z.array(EvalInputFile),
  input_meta: EvalPrMeta,
  expected_output: z.array(EvalExpectedFinding),
  forbidden_location: EvalLocation.nullable(),
  source_finding_id: z.string().nullable(),
  source_decision: EvalSourceDecision.nullable(),
  notes: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionStatus = z.enum(['pending', 'approved', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'errors',
  'testing',
  'imports',
  'typing',
  'api',
  'general',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string().nullable(),
  category: ConventionCategory,
  rule: z.string(),
  rationale: z.string().nullable(),
  evidence_path: z.string().nullable(),
  /** 1-based, as VERIFIED by code — never the model's unchecked claim. */
  evidence_line: z.number().int().nullable(),
  evidence_snippet: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: ConventionStatus,
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
