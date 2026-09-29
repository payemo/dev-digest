/**
 * project-context — repository documents attached to agents and skills.
 *
 * Four tables:
 *   - contextDocuments      one row per document, holding its full snapshot
 *   - agentContextDocuments agent → document, per repository, user-ordered
 *   - skillContextDocuments skill → document, per repository, user-ordered
 *   - contextSyncState      1:1 per repo, what the last scan did
 *
 * Nothing imports this file, and it imports only `repos`/`agents`/`skills`/
 * `workspaces`, so there is no schema import cycle to worry about.
 *
 * Two link tables rather than one polymorphic `(owner_kind, owner_id)` table:
 * that keeps real foreign keys and cascade deletes on BOTH owners (deleting an
 * agent or a skill drops its attachments for free), mirrors the existing
 * `agent_skills` precedent, and avoids a CHECK-constrained table with two
 * nullable FKs. The cost is one duplicated four-column table.
 *
 * Nothing here writes to `code_chunks` — documents are stored whole and are
 * never chunked or embedded.
 */
import { pgTable, uuid, text, integer, timestamp, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

/**
 * One project-context document. `content` is the SNAPSHOT the server stored,
 * and it is what a run injects — never the file on disk at run time, so a run
 * is reproducible from the trace even after the clone moves.
 *
 * The unique index is `(repo_id, origin, path)`, not `(repo_id, path)`. Including
 * `origin` is what makes it structurally possible for a discovered file and a
 * studio-authored document to coexist at the same path as two separate,
 * separately-attachable rows, while still making two user-authored documents at
 * one path a conflict.
 *
 * `availability` is how a vanished discovered file is recorded: the row stays
 * (with its attachments) and flips to `missing`, so a run can skip it with a
 * note instead of the attachment silently disappearing.
 *
 * Read paths that only need metadata must not select `content`. Postgres TOASTs
 * a `text` column over ~2 KB out of line, so leaving it out of the list query
 * is what keeps that query cheap.
 */
export const contextDocuments = pgTable(
  'context_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /** Repo-relative posix path, e.g. `.devdigest/specs/public-api.md`. */
    path: text('path').notNull(),
    name: text('name').notNull(),
    /** Between the category directory and the name; `''` at the category root. */
    folder: text('folder').notNull(),
    category: text('category', { enum: ['specs', 'docs', 'insights'] }).notNull(),
    origin: text('origin', { enum: ['repo', 'user'] }).notNull(),
    availability: text('availability', { enum: ['present', 'missing'] })
      .notNull()
      .default('present'),
    content: text('content').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Stored token count from the one shared counting scheme. */
    tokenCount: integer('token_count').notNull().default(0),
    /** sha256 hex of `content` — changes iff the content changed. */
    fingerprint: text('fingerprint').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    originPathUq: uniqueIndex('context_documents_repo_origin_path_uq').on(
      t.repoId,
      t.origin,
      t.path,
    ),
    repoIdx: index('context_documents_repo_idx').on(t.repoId),
    workspaceIdx: index('context_documents_workspace_idx').on(t.workspaceId),
  }),
);

/**
 * An agent's own attachments, scoped to one repository — agents stay
 * workspace-global while what they read is per-repo, which is why `repoId` is
 * part of the key rather than derivable from the agent.
 *
 * `order` is assigned from the array index on every whole-list write, the same
 * "replace the full set" semantics `agent_skills` uses. The `(repoId, documentId)`
 * index serves the reverse lookup ("how many agents use this document?").
 */
export const agentContextDocuments = pgTable(
  'agent_context_documents',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => contextDocuments.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.documentId] }),
    docIdx: index('agent_context_documents_repo_doc_idx').on(t.repoId, t.documentId),
  }),
);

/**
 * A skill's attachments, same shape on the skill side. A skill contributes
 * WHICH documents an agent using it reads; it never contributes their text,
 * because the skills prompt block is injected as trusted instructions while
 * document bodies must stay inside the untrusted project-context block.
 */
export const skillContextDocuments = pgTable(
  'skill_context_documents',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => contextDocuments.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.documentId] }),
    docIdx: index('skill_context_documents_repo_doc_idx').on(t.repoId, t.documentId),
  }),
);

/**
 * What the last document scan DID, 1:1 per repo (PK = repoId, like
 * `repo_index_state`).
 *
 * `outcome` records only the scan's own result. Freshness — `fresh` vs `stale`
 * — is derived from `lastSyncedAt` at read time, so no background job has to
 * age a stored row and a never-synced repo needs no special row.
 */
export const contextSyncState = pgTable('context_sync_state', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  lastSyncedSha: text('last_synced_sha'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  documentCount: integer('document_count').notNull().default(0),
  outcome: text('outcome', { enum: ['ok', 'failed', 'bounded'] })
    .notNull()
    .default('ok'),
  /** Why it is `failed`/`bounded` — e.g. `no_clone`, `bounded:42`. */
  reason: text('reason'),
});
