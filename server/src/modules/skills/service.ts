import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillAgentUsage,
  SkillCreate,
  SkillStats,
  SkillUpdate,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository, type ListSkillsFilter } from './repository.js';
import {
  computeSkillStats,
  isBodyChange,
  mayBeEnabledOnCreate,
  toSkillDto,
  toSkillVersionDto,
} from './helpers.js';
import { DEFAULT_SKILL_SOURCE, DEFAULT_SKILL_TYPE, STATS_WINDOW_DAYS } from './constants.js';

/**
 * Skills service. A Skill = name + description + type + markdown body, linked
 * to agents through `agent_skills` (the agents module owns that link table's
 * write side; this module owns the skill itself).
 *
 * The description is the skill's INTERFACE — it is what tells an agent when to
 * reach for the skill — while the body is the rule text injected into the
 * prompt. Body changes are versioned via `skill_versions`.
 */

export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string, filter: ListSkillsFilter = {}): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId, filter);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /** Exact-name lookup — other modules use this to detect a conflict before creating a skill under a canonical name. */
  async getByName(workspaceId: string, name: string): Promise<Skill | undefined> {
    const row = await this.repo.getByName(workspaceId, name);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Create a skill.
   *
   * A skill body reaches the model as INSTRUCTIONS — it is the one prompt block
   * `assemblePrompt` deliberately does not delimiter-wrap. So a skill that did
   * not come from someone typing it here is forced to `enabled: false`
   * regardless of what the request asked for, and only a human enabling it by
   * hand can put a stranger's text into an agent's prompt. Do not relax this.
   */
  async create(workspaceId: string, input: SkillCreate): Promise<Skill> {
    const source = input.source ?? DEFAULT_SKILL_SOURCE;
    const requestedEnabled = input.enabled ?? true;
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type ?? DEFAULT_SKILL_TYPE,
      source,
      body: input.body,
      enabled: mayBeEnabledOnCreate(source) ? requestedEnabled : false,
      evidenceFiles: input.evidence_files ?? null,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: SkillUpdate,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;
    const bodyChanged = isBodyChange(existing, patch);
    const row = await this.repo.update(
      workspaceId,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
      },
      bodyChanged,
    );
    return row ? toSkillDto(row) : undefined;
  }

  /** Delete a skill. Versions, agent links and run attribution cascade away. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body history for a skill, newest version first. Workspace-scoped: returns
   * undefined when the skill isn't in this workspace (the route maps that to a
   * 404) so snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /** A single body snapshot (route → 404 when absent or cross-tenant). */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  /** Agents currently linking this skill. */
  async agentsUsing(
    workspaceId: string,
    skillId: string,
  ): Promise<SkillAgentUsage[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.agentsUsing(skillId);
    return rows.map((r) => ({
      agent_id: r.agentId,
      agent_name: r.agentName,
      enabled: r.agentEnabled,
      order: r.order,
    }));
  }

  /**
   * Usage stats over the rolling window. Findings numbers are attributed
   * through `run_skills` — i.e. they describe runs in which the skill was
   * injected, NOT findings the skill caused.
   */
  async stats(workspaceId: string, skillId: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [usedByAgents, runs, outcomes] = await Promise.all([
      this.repo.usedByCount(skillId),
      this.repo.runCounts(skillId, since),
      this.repo.findingOutcomes(skillId, since),
    ]);
    return computeSkillStats({
      skillId,
      usedByAgents,
      linkedAgentRuns: runs.linkedAgentRuns,
      injectedRuns: runs.injectedRuns,
      accepted: outcomes.accepted,
      dismissed: outcomes.dismissed,
      byCategory: outcomes.byCategory,
    });
  }
}
