import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';
import type { VerifiedCandidate } from './helpers.js';

export type { ConventionRow };

export type ConventionCategoryValue = (typeof t.conventions.category.enumValues)[number];

export interface UpdateConvention {
  status?: 'pending' | 'approved' | 'rejected';
  rule?: string;
  category?: ConventionCategoryValue;
  rationale?: string | null;
}

/**
 * Conventions data-access. Owns the `conventions` table only — the ONE place
 * that touches it. Every query is workspace-scoped.
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  async listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.createdAt));
  }

  async listByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }

  async listApprovedForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    const rows = await this.listForRepo(workspaceId, repoId);
    return rows.filter((r) => r.status === 'approved');
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }

  /**
   * Replace this repo's PENDING candidates with a freshly-verified set from a
   * scan. Approved and rejected rows are untouched — a re-scan must never
   * re-litigate a decision the user already made.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    kept: VerifiedCandidate[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            eq(t.conventions.status, 'pending'),
          ),
        );
      if (kept.length === 0) return;
      await tx.insert(t.conventions).values(
        kept.map((c) => ({
          workspaceId,
          repoId,
          category: c.category,
          rule: c.rule,
          rationale: c.rationale,
          evidencePath: c.evidencePath,
          evidenceLine: c.evidenceLine,
          evidenceSnippet: c.evidenceSnippet,
          confidence: c.confidence,
          status: 'pending' as const,
        })),
      );
    });
  }
}
