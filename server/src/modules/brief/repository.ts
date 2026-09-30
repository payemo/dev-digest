import { eq } from 'drizzle-orm';
import type { PrBriefStored } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * PR Brief data-access — the ONLY layer touching `pr_brief` for this module.
 *
 * No workspace check here: `pr_brief` carries no `workspace_id`, and every
 * `prId` passed in has already been resolved inside the caller's workspace by
 * the service (the PR lookup IS the tenancy check).
 */
export class BriefRepository {
  constructor(private db: Db) {}

  /** The raw stored document, unparsed — the service validates it on read. */
  async getBrief(prId: string): Promise<unknown | undefined> {
    const [row] = await this.db
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId));
    return row?.json;
  }

  /** One row per PR, replaced in place on regeneration. */
  async upsertBrief(prId: string, json: PrBriefStored): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json } });
  }
}
