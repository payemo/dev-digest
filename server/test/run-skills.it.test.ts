import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/routes/users.ts b/src/routes/users.ts
--- a/src/routes/users.ts
+++ b/src/routes/users.ts
@@ -10,3 +10,4 @@
   fastify.get('/users/:id', async (req) => {
-    return { id: user.id, email: user.email };
+    return { id: user.id, userEmail: user.email };
   });`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/**
 * This test is the deterministic regression guard for the whole skills
 * feature: with a stubbed LLM, the model's output never changes, so ANY
 * observed difference between the two runs below comes from the skills
 * mechanism alone — not from model variance. It proves the MECHANISM; the
 * manual control experiment in the plan (a real model, a real breaking
 * change) demonstrates VALUE.
 */
d('skills reach the prompt (run_skills attribution + prompt assembly)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  let repoSeq = 0;
  async function setupRepoAndPr() {
    const name = `contract-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 501,
        title: 'Rename user field in response',
        author: 'dev',
        branch: 'feat/rename',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 1,
        filesCount: 1,
        status: 'needs_review',
        body: 'Small cleanup.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/routes/users.ts',
      additions: 1,
      deletions: 1,
      patch: DIFF,
    });
    return { repo: repo!, pr: pr! };
  }

  async function makeAgent(app: Awaited<ReturnType<typeof appWith>>) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Contract Reviewer ${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You review API contracts.',
      },
    });
    return res.json();
  }

  async function makeSkill(
    app: Awaited<ReturnType<typeof appWith>>,
    name: string,
    enabled = true,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name,
        description: 'Flag breaking route-signature changes.',
        type: 'rubric',
        body: '- A renamed response field is a breaking change.',
        enabled,
      },
    });
    return res.json();
  }

  it('an agent with no linked skills gets no Skills/rules block and no run_skills rows', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr();
    const agent = await makeAgent(app);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toBeNull();
    expect(trace.log.some((l: { msg: string }) => l.msg.includes('skills:'))).toBe(false);

    const rows = await pg.handle.db
      .select()
      .from(t.runSkills)
      .where(eq(t.runSkills.runId, runId));
    expect(rows).toHaveLength(0);
  });

  it('an enabled linked skill reaches the prompt AND is recorded in run_skills; a disabled one does neither', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr();
    const agent = await makeAgent(app);

    const kept = await makeSkill(app, 'API contract compatibility', true);
    const dropped = await makeSkill(app, 'Style nit rubric', false);

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [kept.id, dropped.id] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // Prompt assembly: the enabled skill's block is present, the disabled
    // skill's name never appears anywhere in the assembled prompt.
    expect(trace.prompt_assembly.skills).toContain('API contract compatibility');
    expect(trace.prompt_assembly.skills).not.toContain('Style nit rubric');
    expect(trace.prompt_assembly.user).toContain('## Skills / rules');

    // Live log carries the observable evidence, naming both what went in and
    // what was skipped.
    const skillsLine = trace.log.find((l: { msg: string }) => l.msg.startsWith('skills:'));
    expect(skillsLine).toBeDefined();
    expect(skillsLine.msg).toContain('1 of 2');
    expect(skillsLine.msg).toContain('API contract compatibility');
    expect(skillsLine.msg).toContain('Style nit rubric');

    // Attribution: exactly one run_skills row, for the enabled skill only.
    const rows = await pg.handle.db
      .select()
      .from(t.runSkills)
      .where(eq(t.runSkills.runId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.skillId).toBe(kept.id);
  });
});
