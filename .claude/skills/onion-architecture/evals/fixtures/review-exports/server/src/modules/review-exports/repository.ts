import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { FindingRow } from '../../db/rows.js';

export class ReviewExportRepository {
  constructor(private db: Db) {}

  async findingsForReview(workspaceId: string, reviewId: string, limit: number): Promise<FindingRow[]> {
    const rows = await this.db
      .select({ finding: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.findings.reviewId, reviewId)))
      .limit(limit);
    return rows.map((r) => r.finding);
  }

  async existingReviewIds(workspaceId: string, ids: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.id, ids)));
    return rows.map((r) => r.id);
  }
}
