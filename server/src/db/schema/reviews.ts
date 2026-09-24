import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';
import { agentRuns } from './runs';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  /** The agent_run that produced this review (links the timeline run ↔ review).
   *  Cascades: deleting a run deletes the review it produced (and, via
   *  findings.reviewId, its findings) in one statement — see
   *  reviews/repository/run.repo.ts's `deleteAgentRun`. */
  runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // Postgres does not auto-index the referencing side of an FK; without
    // this, `DELETE FROM reviews` seq-scans findings on every cascade.
    reviewIdx: index('findings_review_id_idx').on(t.reviewId),
  }),
);

/**
 * One derived intent record per PR — the cache for the intent derivation, keyed
 * by `pr_id` and invalidated by `head_sha` (new commits can change what a PR is
 * for). Read by primary key only, so no secondary index.
 *
 * `confidence` is COMPUTED IN CODE from `sources` (the evidence markers that
 * were actually present), never returned by the model. `sources` is kept
 * alongside it so any number on screen is auditable.
 *
 * `tokens_in`/`tokens_out`/`cost_usd` are the derivation call's OWN usage and
 * live here rather than on `agent_runs`: one derivation serves every queued run
 * of the PR, and `agent_runs.cost_usd` must keep meaning "what this agent run
 * cost".
 */
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  confidence: doublePrecision('confidence').notNull().default(0),
  riskAreas: jsonb('risk_areas')
    .$type<{ label: string; evidence_path: string | null }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  sources: jsonb('sources').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  provider: text('provider'),
  model: text('model'),
  /** The PR head this intent was derived against; `!=` current head ⇒ stale. */
  headSha: text('head_sha'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: doublePrecision('cost_usd'),
  // timestamptz, like every other timestamp in this schema. NOT the shared
  // `now()` helper: that helper hardcodes the column name `created_at`, and
  // this column is `derived_at` (a re-derivation overwrites the row in place,
  // so "when was this derived" is the only meaningful timestamp).
  derivedAt: timestamp('derived_at', { withTimezone: true }).defaultNow().notNull(),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
