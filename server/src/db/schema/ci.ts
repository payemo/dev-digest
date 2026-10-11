import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { repos } from './repos';
// One-way import: runs.ts never imports ci.ts, so this closes no cycle.
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    /** The imported studio repo this installation targets (null if it was removed). */
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    /** Slug used for the exported manifest + workflow file names. */
    agentSlug: text('agent_slug').notNull().default(''),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    triggers: jsonb('triggers')
      .$type<string[]>()
      .notNull()
      .default(['opened', 'synchronize']),
    workflowPath: text('workflow_path'),
    /** The installed (possibly user-edited) workflow, reused by "Update CI config". */
    workflowYaml: text('workflow_yaml'),
    workflowVersion: integer('workflow_version'),
    manifestVersion: integer('manifest_version'),
    manifestSha256: text('manifest_sha256'),
    runnerVersion: text('runner_version'),
    runnerSha256: text('runner_sha256'),
    /** Git blob SHA per exported path — the ingest's verification baseline. */
    expectedBlobs: jsonb('expected_blobs').$type<Record<string, string>>(),
    /** Branch the files were committed to; null for a zip ("files") export. */
    branch: text('branch'),
    prUrl: text('pr_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (t) => ({
    agentRepoUq: uniqueIndex('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
    repoIdx: index('ci_installations_repo_idx').on(t.repo),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    /** GitHub Actions run URL (kept for back-compat; same value as jobUrl). */
    githubUrl: text('github_url'),
    source: text('source'),
    /** The `agent_runs` row (source='ci') this CI run produced. */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    githubRunId: bigint('github_run_id', { mode: 'number' }),
    githubRunAttempt: integer('github_run_attempt'),
    repo: text('repo'),
    headSha: text('head_sha'),
    jobUrl: text('job_url'),
    verdict: text('verdict'),
    verification: text('verification', { enum: ['verified', 'unverified'] }),
    durationMs: integer('duration_ms'),
    /** Findings count the artifact claimed, before the studio re-grounded them. */
    reportedFindingsCount: integer('reported_findings_count'),
  },
  (t) => ({
    githubRunUq: uniqueIndex('ci_runs_github_run_id_uq').on(t.githubRunId),
    installationRanIdx: index('ci_runs_installation_ran_idx').on(t.ciInstallationId, t.ranAt),
  }),
);
