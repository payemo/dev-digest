import { and, asc, eq, getTableName, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ContextDocumentCategory, ContextDocumentOrigin, ContextOwnerKind } from '@devdigest/shared';

/**
 * project-context data-access. Owns `context_documents`, both attachment link
 * tables, and `context_sync_state`. Takes `Db`; every method is scoped by
 * workspace, by repo, or by both.
 *
 * `content` is selected ONLY by the methods that actually need a body
 * (`getDocument`, `documentsByIds`). The list query leaves it out on purpose:
 * Postgres stores a large `text` out of line, so not asking for it is what
 * keeps listing a repository's documents cheap.
 */

import type { ContextDocumentRow, ContextSyncStateRow } from '../../db/rows.js';
export type { ContextDocumentRow, ContextSyncStateRow };

/** A document summary row — every column except the snapshot body. */
export type ContextDocumentSummaryRow = Omit<ContextDocumentRow, 'content'> & {
  usedByAgents: number;
};

export interface UpsertRepoDocument {
  workspaceId: string;
  repoId: string;
  path: string;
  name: string;
  folder: string;
  category: ContextDocumentCategory;
  content: string;
  sizeBytes: number;
  tokenCount: number;
  fingerprint: string;
}

export interface InsertUserDocument extends UpsertRepoDocument {}

export interface UpsertSyncState {
  repoId: string;
  lastSyncedSha: string | null;
  lastSyncedAt: Date | null;
  documentCount: number;
  outcome: 'ok' | 'failed' | 'bounded';
  reason: string | null;
}

/** The metadata columns, shared by every summary-shaped select. */
const SUMMARY_COLUMNS = {
  id: t.contextDocuments.id,
  workspaceId: t.contextDocuments.workspaceId,
  repoId: t.contextDocuments.repoId,
  path: t.contextDocuments.path,
  name: t.contextDocuments.name,
  folder: t.contextDocuments.folder,
  category: t.contextDocuments.category,
  origin: t.contextDocuments.origin,
  availability: t.contextDocuments.availability,
  sizeBytes: t.contextDocuments.sizeBytes,
  tokenCount: t.contextDocuments.tokenCount,
  fingerprint: t.contextDocuments.fingerprint,
  updatedAt: t.contextDocuments.updatedAt,
} as const;

/**
 * The OUTER row's `context_documents.id`, table-qualified. In a single-table
 * select Drizzle renders `${t.contextDocuments.id}` inside a `sql` fragment as
 * a bare `"id"`, which Postgres binds to the nearest scope that has an `id`
 * (`agents a` in `listDocuments`), silently de-correlating the subquery.
 */
const OUTER_DOC_ID = sql`${sql.identifier(getTableName(t.contextDocuments))}.${sql.identifier(t.contextDocuments.id.name)}`;

export class ProjectContextRepository {
  constructor(private db: Db) {}

  // ----------------------------------------------------------- documents ----

  /**
   * Every document of one repository, with how many ENABLED agents reach each.
   *
   * The count is a correlated subquery rather than a per-document round trip,
   * and it counts distinct AGENTS: an agent that both attaches a document
   * directly and inherits it from a skill is one user of it, not two. Skills
   * only contribute through their own `enabled` flag, matching what a run would
   * actually inject.
   */
  async listDocuments(workspaceId: string, repoId: string): Promise<ContextDocumentSummaryRow[]> {
    return this.db
      .select({
        ...SUMMARY_COLUMNS,
        usedByAgents: sql<number>`(
          SELECT COUNT(DISTINCT a.id)::int FROM ${t.agents} a
          WHERE a.enabled = true AND (
            EXISTS (
              SELECT 1 FROM ${t.agentContextDocuments} acd
              WHERE acd.agent_id = a.id
                AND acd.repo_id = ${repoId}
                AND acd.document_id = ${OUTER_DOC_ID}
            )
            OR EXISTS (
              SELECT 1 FROM ${t.agentSkills} asl
              JOIN ${t.skills} s ON s.id = asl.skill_id AND s.enabled = true
              JOIN ${t.skillContextDocuments} scd ON scd.skill_id = asl.skill_id
              WHERE asl.agent_id = a.id
                AND scd.repo_id = ${repoId}
                AND scd.document_id = ${OUTER_DOC_ID}
            )
          )
        )`,
      })
      .from(t.contextDocuments)
      .where(
        and(
          eq(t.contextDocuments.workspaceId, workspaceId),
          eq(t.contextDocuments.repoId, repoId),
        ),
      )
      .orderBy(asc(t.contextDocuments.path));
  }

  /** One document WITH its snapshot body. */
  async getDocument(
    workspaceId: string,
    repoId: string,
    docId: string,
  ): Promise<ContextDocumentRow | null> {
    const [row] = await this.db
      .select()
      .from(t.contextDocuments)
      .where(
        and(
          eq(t.contextDocuments.workspaceId, workspaceId),
          eq(t.contextDocuments.repoId, repoId),
          eq(t.contextDocuments.id, docId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The documents behind a set of ids, WITH bodies, scoped to one repository. */
  async documentsByIds(
    workspaceId: string,
    repoId: string,
    ids: string[],
  ): Promise<ContextDocumentRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.contextDocuments)
      .where(
        and(
          eq(t.contextDocuments.workspaceId, workspaceId),
          eq(t.contextDocuments.repoId, repoId),
          inArray(t.contextDocuments.id, ids),
        ),
      );
  }

  /** Which of `ids` actually belong to this repository (and workspace). */
  async idsInRepo(workspaceId: string, repoId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: t.contextDocuments.id })
      .from(t.contextDocuments)
      .where(
        and(
          eq(t.contextDocuments.workspaceId, workspaceId),
          eq(t.contextDocuments.repoId, repoId),
          inArray(t.contextDocuments.id, ids),
        ),
      );
    return rows.map((r) => r.id);
  }

  /**
   * Store a discovered document. The conflict target includes `origin`, which
   * is what lets a studio-authored document at the same path survive untouched
   * — a re-scan can only ever overwrite the `repo`-origin row.
   */
  async upsertRepoDocument(input: UpsertRepoDocument): Promise<void> {
    await this.db
      .insert(t.contextDocuments)
      .values({ ...input, origin: 'repo', availability: 'present', updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [t.contextDocuments.repoId, t.contextDocuments.origin, t.contextDocuments.path],
        set: {
          name: input.name,
          folder: input.folder,
          category: input.category,
          content: input.content,
          sizeBytes: input.sizeBytes,
          tokenCount: input.tokenCount,
          fingerprint: input.fingerprint,
          availability: 'present',
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Insert a studio-authored document. Returns `null` when one already exists
   * at that path — the caller turns that into a conflict rather than silently
   * overwriting what the user wrote.
   */
  async insertUserDocument(input: InsertUserDocument): Promise<ContextDocumentRow | null> {
    const [row] = await this.db
      .insert(t.contextDocuments)
      .values({ ...input, origin: 'user', availability: 'present', updatedAt: new Date() })
      .onConflictDoNothing({
        target: [t.contextDocuments.repoId, t.contextDocuments.origin, t.contextDocuments.path],
      })
      .returning();
    return row ?? null;
  }

  /** Flag discovered documents whose file is gone. They are never deleted. */
  async markMissing(repoId: string, docIds: string[]): Promise<void> {
    if (docIds.length === 0) return;
    await this.db
      .update(t.contextDocuments)
      .set({ availability: 'missing', updatedAt: new Date() })
      .where(and(eq(t.contextDocuments.repoId, repoId), inArray(t.contextDocuments.id, docIds)));
  }

  /** `(id, path, fingerprint)` of every discovered document, for reconciliation. */
  async listRepoDocumentPaths(
    repoId: string,
  ): Promise<{ id: string; path: string; fingerprint: string }[]> {
    return this.db
      .select({
        id: t.contextDocuments.id,
        path: t.contextDocuments.path,
        fingerprint: t.contextDocuments.fingerprint,
      })
      .from(t.contextDocuments)
      .where(
        and(
          eq(t.contextDocuments.repoId, repoId),
          eq(t.contextDocuments.origin, 'repo' satisfies ContextDocumentOrigin),
        ),
      );
  }

  /** Delete one studio-authored document. Returns false when nothing matched. */
  async deleteUserDocument(workspaceId: string, repoId: string, docId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.contextDocuments)
      .where(
        and(
          eq(t.contextDocuments.workspaceId, workspaceId),
          eq(t.contextDocuments.repoId, repoId),
          eq(t.contextDocuments.id, docId),
          eq(t.contextDocuments.origin, 'user' satisfies ContextDocumentOrigin),
        ),
      )
      .returning({ id: t.contextDocuments.id });
    return rows.length > 0;
  }

  // ---------------------------------------------------------- sync state ----

  async getSyncState(repoId: string): Promise<ContextSyncStateRow | null> {
    const [row] = await this.db
      .select()
      .from(t.contextSyncState)
      .where(eq(t.contextSyncState.repoId, repoId))
      .limit(1);
    return row ?? null;
  }

  async upsertSyncState(input: UpsertSyncState): Promise<void> {
    await this.db
      .insert(t.contextSyncState)
      .values(input)
      .onConflictDoUpdate({
        target: t.contextSyncState.repoId,
        set: {
          lastSyncedSha: input.lastSyncedSha,
          lastSyncedAt: input.lastSyncedAt,
          documentCount: input.documentCount,
          outcome: input.outcome,
          reason: input.reason,
        },
      });
  }

  async countDocuments(repoId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(t.contextDocuments)
      .where(eq(t.contextDocuments.repoId, repoId));
    return row?.n ?? 0;
  }

  // --------------------------------------------------------- attachments ----

  /**
   * One owner's own attached documents for one repository, in the user's order.
   * Summary-shaped (no bodies) — this feeds the pickers and the token total.
   */
  async attachmentsFor(
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
  ): Promise<ContextDocumentSummaryRow[]> {
    if (kind === 'agent') {
      const rows = await this.db
        .select({ ...SUMMARY_COLUMNS, order: t.agentContextDocuments.order })
        .from(t.agentContextDocuments)
        .innerJoin(
          t.contextDocuments,
          eq(t.agentContextDocuments.documentId, t.contextDocuments.id),
        )
        .where(
          and(
            eq(t.agentContextDocuments.agentId, ownerId),
            eq(t.agentContextDocuments.repoId, repoId),
          ),
        )
        .orderBy(asc(t.agentContextDocuments.order));
      return rows.map((r) => ({ ...r, usedByAgents: 0 }));
    }
    const rows = await this.db
      .select({ ...SUMMARY_COLUMNS, order: t.skillContextDocuments.order })
      .from(t.skillContextDocuments)
      .innerJoin(t.contextDocuments, eq(t.skillContextDocuments.documentId, t.contextDocuments.id))
      .where(
        and(
          eq(t.skillContextDocuments.skillId, ownerId),
          eq(t.skillContextDocuments.repoId, repoId),
        ),
      )
      .orderBy(asc(t.skillContextDocuments.order));
    return rows.map((r) => ({ ...r, usedByAgents: 0 }));
  }

  /** Just the ordered document ids, for the merge that builds a run's set. */
  async attachedIds(kind: ContextOwnerKind, ownerId: string, repoId: string): Promise<string[]> {
    const rows = await this.attachmentsFor(kind, ownerId, repoId);
    return rows.map((r) => r.id);
  }

  /**
   * Every listed skill's ordered document ids for one repository, in ONE query.
   * Keyed by skill id so the caller can walk them in the agent's skill order.
   */
  async attachmentsForSkills(
    skillIds: string[],
    repoId: string,
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (skillIds.length === 0) return out;
    const rows = await this.db
      .select({
        skillId: t.skillContextDocuments.skillId,
        documentId: t.skillContextDocuments.documentId,
      })
      .from(t.skillContextDocuments)
      .where(
        and(
          eq(t.skillContextDocuments.repoId, repoId),
          inArray(t.skillContextDocuments.skillId, skillIds),
        ),
      )
      .orderBy(asc(t.skillContextDocuments.skillId), asc(t.skillContextDocuments.order));
    for (const row of rows) {
      const list = out.get(row.skillId) ?? [];
      list.push(row.documentId);
      out.set(row.skillId, list);
    }
    return out;
  }

  /**
   * Replace an owner's whole ordered set for one repository, `order = index`.
   * Delete-then-insert inside a transaction: the same "the write IS the full
   * list" semantics the skills editor uses, so two concurrent edits cannot
   * interleave into a half-applied order.
   */
  async replaceAttachments(
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    documentIds: string[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (kind === 'agent') {
        await tx
          .delete(t.agentContextDocuments)
          .where(
            and(
              eq(t.agentContextDocuments.agentId, ownerId),
              eq(t.agentContextDocuments.repoId, repoId),
            ),
          );
        if (documentIds.length === 0) return;
        await tx.insert(t.agentContextDocuments).values(
          documentIds.map((documentId, i) => ({ agentId: ownerId, repoId, documentId, order: i })),
        );
        return;
      }
      await tx
        .delete(t.skillContextDocuments)
        .where(
          and(
            eq(t.skillContextDocuments.skillId, ownerId),
            eq(t.skillContextDocuments.repoId, repoId),
          ),
        );
      if (documentIds.length === 0) return;
      await tx.insert(t.skillContextDocuments).values(
        documentIds.map((documentId, i) => ({ skillId: ownerId, repoId, documentId, order: i })),
      );
    });
  }
}
