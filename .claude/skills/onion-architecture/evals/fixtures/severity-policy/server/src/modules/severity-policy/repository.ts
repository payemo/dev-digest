import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type SeverityPolicyRow = typeof t.severityPolicies.$inferSelect;

export class SeverityPolicyRepository {
  constructor(private db: Db) {}

  async get(workspaceId: string, agentId: string): Promise<SeverityPolicyRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.severityPolicies)
      .where(and(eq(t.severityPolicies.workspaceId, workspaceId), eq(t.severityPolicies.agentId, agentId)));
    return row;
  }

  async upsert(workspaceId: string, agentId: string, floor: string): Promise<SeverityPolicyRow> {
    const [row] = await this.db
      .insert(t.severityPolicies)
      .values({ workspaceId, agentId, floor })
      .onConflictDoUpdate({
        target: [t.severityPolicies.workspaceId, t.severityPolicies.agentId],
        set: { floor },
      })
      .returning();
    return row!;
  }
}
