import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type DigestRow = typeof t.digests.$inferSelect;
export type PullSummaryRow = Pick<
  typeof t.pulls.$inferSelect,
  'id' | 'number' | 'title' | 'state' | 'additions' | 'deletions' | 'updatedAt'
>;

export class DigestRepository {
  constructor(private db: Db) {}

  async pullsInRange(workspaceId: string, from: Date, to: Date): Promise<PullSummaryRow[]> {
    return this.db
      .select({
        id: t.pulls.id,
        number: t.pulls.number,
        title: t.pulls.title,
        state: t.pulls.state,
        additions: t.pulls.additions,
        deletions: t.pulls.deletions,
        updatedAt: t.pulls.updatedAt,
      })
      .from(t.pulls)
      .where(and(eq(t.pulls.workspaceId, workspaceId), gte(t.pulls.updatedAt, from), lte(t.pulls.updatedAt, to)));
  }

  async save(
    workspaceId: string,
    values: Pick<DigestRow, 'periodStart' | 'periodEnd' | 'headline' | 'items'>,
  ): Promise<DigestRow> {
    const [row] = await this.db
      .insert(t.digests)
      .values({ workspaceId, ...values })
      .returning();
    return row!;
  }

  async latest(workspaceId: string): Promise<DigestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.digests)
      .where(eq(t.digests.workspaceId, workspaceId))
      .orderBy(desc(t.digests.createdAt))
      .limit(1);
    return row;
  }
}
