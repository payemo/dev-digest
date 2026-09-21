import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, primaryKey, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';
import { skills } from './skills';

// ============================================================ Observability

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** Provider-reported billed cost (e.g. OpenRouter's usage.cost); null when
   *  the provider didn't report one — derived on read from model + tokens. */
  costUsd: doublePrecision('cost_usd'),
  status: text('status', { enum: ['running', 'done', 'failed', 'cancelled'] })
    .notNull()
    .default('running'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
});

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

/**
 * Which skills actually went into a run's prompt.
 *
 * Written by the run executor at prompt-assembly time, from the ENABLED subset
 * of the agent's linked skills — so it records what was injected, not what was
 * configured. A disabled skill is linked but absent here, exactly as it is
 * absent from the prompt. `order` mirrors agent_skills.order at injection time.
 *
 * Lives here rather than in schema/skills.ts because skills.ts importing
 * runs.ts would close the cycle skills -> runs -> agents -> skills.
 */
export const runSkills = pgTable(
  'run_skills',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.skillId] }),
    // Skill stats filter by skill_id, but the PK's leading column is run_id,
    // which Postgres cannot use for that. Same reasoning as
    // findings_review_id_idx: without this, every Stats load seq-scans.
    skillIdx: index('run_skills_skill_id_idx').on(t.skillId),
  }),
);

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
