import { and, desc, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';

export type PrNoteRow = typeof t.prNotes.$inferSelect;

export class PrNoteRepository {
  constructor(private container: Container) {}

  async list(workspaceId: string, pullId: string, limit: number): Promise<PrNoteRow[]> {
    return this.container.db
      .select()
      .from(t.prNotes)
      .where(and(eq(t.prNotes.workspaceId, workspaceId), eq(t.prNotes.pullId, pullId)))
      .orderBy(desc(t.prNotes.createdAt))
      .limit(limit);
  }

  async insert(workspaceId: string, pullId: string, authorLogin: string, body: string): Promise<PrNoteRow> {
    const [row] = await this.container.db
      .insert(t.prNotes)
      .values({ workspaceId, pullId, authorLogin, body })
      .returning();
    return row!;
  }
}
