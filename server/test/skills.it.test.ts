import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills CRUD + body versioning + the vetting gate.
 *
 * The vetting assertion is the important one: a skill body is injected into the
 * prompt as instructions, so anything not hand-authored must land disabled no
 * matter what the request asked for.
 */
d('/skills', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const body = (over: Record<string, unknown> = {}) => ({
    name: `Skill ${Math.random().toString(36).slice(2, 8)}`,
    description: 'Flag breaking route-signature changes.',
    type: 'rubric' as const,
    body: '- A renamed response field is a breaking change.',
    ...over,
  });

  it('creates a skill with body version 1 recorded', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.version).toBe(1);
    expect(skill.source).toBe('manual');
    expect(skill.enabled).toBe(true);

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
    expect(versions.json()[0]).toMatchObject({ version: 1, body: skill.body });
  });

  it('forces an imported skill to land disabled even when the request says otherwise', async () => {
    // The vetting gate. A community body becomes model INSTRUCTIONS (the one
    // prompt block assemblePrompt does not delimiter-wrap), so a human has to
    // read it before it can reach an agent.
    const app = await makeApp();
    for (const source of ['community', 'imported_url', 'extracted']) {
      const res = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: body({ source, enabled: true }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ source, enabled: false });
    }
  });

  it('bumps the version and snapshots the body when the body changes', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const id = created.json().id as string;

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '- Also: a narrowed param is breaking.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    // Newest first, and the old body is still readable.
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.json()[1].body).toBe(created.json().body);
  });

  it('does NOT bump the version for a rename, reword or enabled toggle', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const id = created.json().id as string;

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { name: 'Renamed', description: 'Reworded.', enabled: false },
    });
    expect(res.json()).toMatchObject({ version: 1, name: 'Renamed', enabled: false });
    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(versions.json()).toHaveLength(1);
  });

  it('lists and filters by type, source and enabled', async () => {
    const app = await makeApp();
    await app.inject({
      method: 'POST',
      url: '/skills',
      payload: body({ name: 'Filterable security', type: 'security' }),
    });

    const byType = await app.inject({ method: 'GET', url: '/skills?type=security' });
    expect(byType.statusCode).toBe(200);
    expect(byType.json().length).toBeGreaterThan(0);
    expect(byType.json().every((s: { type: string }) => s.type === 'security')).toBe(true);

    const byQuery = await app.inject({ method: 'GET', url: '/skills?q=Filterable' });
    expect(byQuery.json().some((s: { name: string }) => s.name === 'Filterable security')).toBe(true);

    const disabled = await app.inject({ method: 'GET', url: '/skills?enabled=false' });
    expect(disabled.json().every((s: { enabled: boolean }) => s.enabled === false)).toBe(true);
  });

  it('404s on an unknown skill, an unknown version, and 422s on a non-uuid id', async () => {
    const app = await makeApp();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${missing}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${missing}/versions` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid' })).statusCode).toBe(422);

    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const id = created.json().id as string;
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${id}/versions/99` })).statusCode,
    ).toBe(404);
  });

  it('deleting a skill cascades its versions and its agent links away', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const skillId = created.json().id as string;

    const agent = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Linker ${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const agentId = agent.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skillId}` });
    expect(del.statusCode).toBe(200);

    const db = pg.handle.db;
    expect(
      await db.select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skillId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(t.agentSkills)
        .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId))),
    ).toHaveLength(0);
  });

  it('reports the agents linking a skill', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const skillId = created.json().id as string;

    const before = await app.inject({ method: 'GET', url: `/skills/${skillId}/agents` });
    expect(before.json()).toEqual([]);

    const agent = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `User ${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const agentId = agent.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const after = await app.inject({ method: 'GET', url: `/skills/${skillId}/agents` });
    expect(after.json()).toHaveLength(1);
    expect(after.json()[0]).toMatchObject({ agent_id: agentId, order: 0, enabled: true });
  });

  it('reports empty stats with null rates for an unused skill', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const res = await app.inject({ method: 'GET', url: `/skills/${created.json().id}/stats` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      used_by_agents: 0,
      linked_agent_runs: 0,
      injected_runs: 0,
      pull_frequency_pct: null,
      findings: 0,
      accept_rate: null,
      by_category: [],
    });
  });
});
