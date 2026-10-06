import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type FindingLabelRow = typeof t.findingLabels.$inferSelect;

export class FindingLabelRepository {
  constructor(private db: Db) {}

  async listForFinding(workspaceId: string, findingId: string): Promise<FindingLabelRow[]> {
    return this.db
      .select()
      .from(t.findingLabels)
      .where(and(eq(t.findingLabels.workspaceId, workspaceId), eq(t.findingLabels.findingId, findingId)));
  }

  async insert(
    workspaceId: string,
    findingId: string,
    name: string,
    color: string,
  ): Promise<FindingLabelRow> {
    const [row] = await this.db
      .insert(t.findingLabels)
      .values({ workspaceId, findingId, name, color })
      .returning();
    return row!;
  }

  async remove(workspaceId: string, labelId: string): Promise<boolean> {
    const res = await this.db
      .delete(t.findingLabels)
      .where(and(eq(t.findingLabels.workspaceId, workspaceId), eq(t.findingLabels.id, labelId)))
      .returning({ id: t.findingLabels.id });
    return res.length > 0;
  }
}
