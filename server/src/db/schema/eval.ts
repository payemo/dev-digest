import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

/**
 * An eval case — a frozen input + an expectation, owned by an agent (or, unused
 * so far, a skill). `source_finding_id` deliberately has no FK: the link must
 * survive the finding's deletion (the case input is a frozen copy).
 */
export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['must_find', 'must_not_flag'] })
      .notNull()
      .default('must_find'),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    /** `{file,start_line,end_line}` — only for `must_not_flag`. */
    forbiddenLocation: jsonb('forbidden_location'),
    sourceFindingId: uuid('source_finding_id'),
    sourceDecision: text('source_decision', { enum: ['accepted', 'dismissed'] }),
    notes: text('notes'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ownerNameUq: uniqueIndex('eval_cases_owner_name_uq').on(t.ownerKind, t.ownerId, t.name),
    // One case per (agent, source finding) — seeding the same finding twice
    // yields the existing case.
    sourceFindingUq: uniqueIndex('eval_cases_owner_source_finding_uq')
      .on(t.ownerId, t.sourceFindingId)
      .where(sql`source_finding_id IS NOT NULL`),
  }),
);

/**
 * An agent-wide eval run: every case of the agent's set, pinned at start to an
 * agent version, a linked-skill snapshot and the case ids. The partial unique
 * index makes "at most one running run per agent" a database guarantee.
 */
export const evalAgentRuns = pgTable(
  'eval_agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    provider: text('provider'),
    model: text('model').notNull(),
    skillSnapshot: jsonb('skill_snapshot').notNull(),
    caseIds: jsonb('case_ids').notNull(),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    casesTotal: integer('cases_total').notNull().default(0),
    casesDone: integer('cases_done').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    errored: integer('errored').notNull().default(0),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => ({
    agentStartedIdx: index('eval_agent_runs_agent_started_idx').on(t.agentId, t.startedAt),
    oneRunningUq: uniqueIndex('eval_agent_runs_one_running_uq')
      .on(t.agentId)
      .where(sql`status = 'running'`),
  }),
);

/**
 * One case execution's result. A row of a full run (`suite_run_id` set) or a
 * single-case run (`suite_run_id` null). `case_id` has no FK so deleting a case
 * keeps history; `case_name`/`case_kind` are copied for the same reason.
 * Rows written before the eval pipeline have a null `agent_id` and are never
 * matched by any eval query.
 */
export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id'),
    suiteRunId: uuid('suite_run_id').references(() => evalAgentRuns.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version'),
    caseName: text('case_name'),
    caseKind: text('case_kind', { enum: ['must_find', 'must_not_flag'] }),
    status: text('status', { enum: ['passed', 'failed', 'errored'] }),
    reason: text('reason'),
    emitted: integer('emitted'),
    grounded: integer('grounded'),
    expectedN: integer('expected_n'),
    gotM: integer('got_m'),
    matched: jsonb('matched'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    caseRanIdx: index('eval_runs_case_ran_idx').on(t.caseId, t.ranAt),
    suiteRunIdx: index('eval_runs_suite_run_idx').on(t.suiteRunId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
