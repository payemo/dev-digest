import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`, and reads (never
 * writes) `agent_skills` / `agent_runs` / `run_skills` / `reviews` / `findings`
 * to build per-skill usage stats.
 *
 * Reading those tables directly is deliberate: the stats aggregate is one
 * read-only query spanning five tables, and smearing it across three modules'
 * repositories would be worse. What the layering rule forbids — importing
 * another module's `repository.ts` — is not done here or in the service.
 *
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface ListSkillsFilter {
  q?: string;
  type?: SkillType;
  source?: SkillSource;
  enabled?: boolean;
}

/** One agent linking a skill, joined from agent_skills. */
export interface SkillAgentRow {
  agentId: string;
  agentName: string;
  agentEnabled: boolean;
  order: number;
}

/** The transaction-scoped `db` handle `Db['transaction']`'s callback receives. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, filter: ListSkillsFilter = {}): Promise<SkillRow[]> {
    const where = [eq(t.skills.workspaceId, workspaceId)];
    if (filter.type !== undefined) where.push(eq(t.skills.type, filter.type));
    if (filter.source !== undefined) where.push(eq(t.skills.source, filter.source));
    if (filter.enabled !== undefined) where.push(eq(t.skills.enabled, filter.enabled));
    if (filter.q) {
      // Case-insensitive substring over name + description. ILIKE is enough at
      // studio scale; the skills table is tens of rows, not millions.
      const needle = `%${filter.q}%`;
      where.push(
        sql`(${t.skills.name} ILIKE ${needle} OR ${t.skills.description} ILIKE ${needle})`,
      );
    }
    return this.db
      .select()
      .from(t.skills)
      .where(and(...where))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Insert a skill AND record body version 1 (immutable snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description,
          type: values.type,
          source: values.source,
          body: values.body,
          enabled: values.enabled,
          version: INITIAL_SKILL_VERSION,
          evidenceFiles: values.evidenceFiles ?? null,
        })
        .returning();
      await this.snapshotVersion(tx, row!, INITIAL_SKILL_VERSION);
      return row!;
    });
  }

  /**
   * Update a skill. A BODY change bumps the version and snapshots the new body
   * into `skill_versions`, so an eval can be replayed against the exact text it
   * scored. Renames / description edits / enabled toggles do not bump.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    bodyChanged: boolean,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(t.skills)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.evidenceFiles !== undefined ? { evidenceFiles: patch.evidenceFiles } : {}),
          ...(bodyChanged ? { version: nextVersion } : {}),
        })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();

      if (bodyChanged && row) await this.snapshotVersion(tx, row, nextVersion);
      return row;
    });
  }

  /** Delete a skill (scoped to workspace). Versions, agent links and run
   *  attribution cascade. Returns false when no such skill existed here. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  private async snapshotVersion(tx: Tx, row: SkillRow, version: number): Promise<void> {
    await tx
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) --------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single body snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- usage + stats (read-only across module boundaries) -----------------

  /** Agents currently linking this skill, in their own link order. */
  async agentsUsing(skillId: string): Promise<SkillAgentRow[]> {
    const rows = await this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        agentEnabled: t.agents.enabled,
        order: t.agentSkills.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name));
    return rows;
  }

  /**
   * Runs in the window by agents linking this skill, split into the ones that
   * actually injected it and the ones that did not.
   *
   * The denominator counts only runs that recorded attribution at all (i.e. at
   * least one run_skills row). Runs from before this table existed carry no
   * attribution, and counting them would peg every skill's pull frequency near
   * zero forever.
   */
  async runCounts(
    skillId: string,
    since: Date,
  ): Promise<{ linkedAgentRuns: number; injectedRuns: number }> {
    const linkedAgents = this.db
      .select({ agentId: t.agentSkills.agentId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));

    const [linked] = await this.db
      .select({ n: count() })
      .from(t.agentRuns)
      .where(
        and(
          gte(t.agentRuns.ranAt, since),
          isNotNull(t.agentRuns.agentId),
          inArray(t.agentRuns.agentId, linkedAgents),
          sql`EXISTS (SELECT 1 FROM ${t.runSkills} WHERE ${t.runSkills.runId} = ${t.agentRuns.id})`,
        ),
      );

    const [injected] = await this.db
      .select({ n: count() })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .where(and(eq(t.runSkills.skillId, skillId), gte(t.agentRuns.ranAt, since)));

    return { linkedAgentRuns: linked?.n ?? 0, injectedRuns: injected?.n ?? 0 };
  }

  /**
   * Findings from runs in which this skill was injected, counted by category,
   * plus accepted/dismissed totals.
   *
   * CORRELATION ONLY. A finding produced by a run that included this skill was
   * not necessarily produced BECAUSE of it — the model sees the whole prompt at
   * once and never attributes a finding to a block. The caller must label this
   * "in runs with this skill".
   */
  async findingOutcomes(
    skillId: string,
    since: Date,
  ): Promise<{ byCategory: { category: string; count: number }[]; accepted: number; dismissed: number }> {
    const rows = await this.db
      .select({
        category: t.findings.category,
        n: count(),
        accepted: sql<number>`count(${t.findings.acceptedAt})::int`,
        dismissed: sql<number>`count(${t.findings.dismissedAt})::int`,
      })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .innerJoin(t.reviews, eq(t.reviews.runId, t.agentRuns.id))
      .innerJoin(t.findings, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.runSkills.skillId, skillId), gte(t.agentRuns.ranAt, since)))
      .groupBy(t.findings.category);

    return {
      byCategory: rows.map((r) => ({ category: r.category, count: r.n })),
      accepted: rows.reduce((sum, r) => sum + Number(r.accepted), 0),
      dismissed: rows.reduce((sum, r) => sum + Number(r.dismissed), 0),
    };
  }

  /** How many agents link this skill. */
  async usedByCount(skillId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    return row?.n ?? 0;
  }
}
