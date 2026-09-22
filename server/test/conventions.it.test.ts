import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A repo-intel double that returns a caller-supplied list of "top ranked"
 * source paths and nothing else — every other method throws, so a test fails
 * loudly if the service ever reaches for a capability the Conventions
 * Extractor doesn't use.
 */
class FakeRepoIntel implements RepoIntel {
  constructor(private codePaths: string[] = []) {}
  async getConventionSamples(): Promise<string[]> {
    return this.codePaths;
  }
  indexRepo(): never {
    throw new Error('not used by conventions');
  }
  refreshIndex(): never {
    throw new Error('not used by conventions');
  }
  getIndexState(): never {
    throw new Error('not used by conventions');
  }
  getBlastRadius(): never {
    throw new Error('not used by conventions');
  }
  getRepoMap(): never {
    throw new Error('not used by conventions');
  }
  getFileRank(): never {
    throw new Error('not used by conventions');
  }
  getSymbolsInFiles(): never {
    throw new Error('not used by conventions');
  }
  getCallerSignatures(): never {
    throw new Error('not used by conventions');
  }
  getUnresolvedReferences(): never {
    throw new Error('not used by conventions');
  }
  getTopFilesByRank(): never {
    throw new Error('not used by conventions');
  }
  getCriticalPaths(): never {
    throw new Error('not used by conventions');
  }
}

const USERS_TS = ['import { db } from "../db";', 'const user = await db.users.find(id);', 'return user;'].join(
  '\n',
);

function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    rule: 'Use async/await instead of .then() chains.',
    rationale: 'Keeps handlers consistent.',
    evidence_path: 'src/api/users.ts',
    evidence_line: 2,
    evidence_snippet: 'const user = await db.users.find(id);',
    category: 'errors',
    occurrences: 3,
    confidence: 0.85,
    ...overrides,
  };
}

d('Conventions Extractor (extract, triage, skill creation)', () => {
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

  async function appWith(fixture: unknown = { candidates: [validCandidate()] }) {
    const llm = new MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: fixture } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: { 'src/api/users.ts': USERS_TS } }),
        repoIntel: new FakeRepoIntel(['src/api/users.ts']),
        llm: { openai: llm },
      },
    });
    return { app, llm };
  }

  let repoSeq = 0;
  async function makeRepo() {
    const name = `sample-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!;
  }

  /**
   * The canonical skill name is fixed ('repo-conventions'), and Skills are
   * workspace-scoped, not repo-scoped — so any two tests in this shared
   * workspace that both create it would collide. Tests that exercise skill
   * creation start from a clean slate for that name.
   */
  async function clearConventionsSkill() {
    await pg.handle.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'repo-conventions')));
  }

  it('404s on an unknown repo', async () => {
    const { app } = await appWith();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/00000000-0000-0000-0000-000000000000/conventions/extract`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('samples configs + repo-intel files before the (single) LLM call, persists valid candidates, and drops invented evidence', async () => {
    const { app, llm } = await appWith({
      candidates: [
        validCandidate(),
        {
          rule: 'This rule cites text that is not in any sampled file.',
          rationale: 'invented',
          evidence_path: 'src/api/users.ts',
          evidence_line: 1,
          evidence_snippet: 'this text does not exist anywhere in the sample',
          category: 'general',
          occurrences: 1,
          confidence: 0.6,
        },
      ],
    });
    const repo = await makeRepo();

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Exactly one model call, and it carries the sampled paths — proving
    // sampling ran (and fed the prompt) before that one call was made.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
    const req = structuredCalls[0]!.req as { messages: { content: string }[] };
    expect(req.messages.some((m) => m.content.includes('src/api/users.ts'))).toBe(true);

    expect(body.proposed).toBe(2);
    expect(body.dropped_ungrounded).toBe(1);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].rule).toBe('Use async/await instead of .then() chains.');
    expect(body.candidates[0].status).toBe('pending');
    expect(body.candidates[0].evidence_snippet).toContain('await db.users.find(id)');

    // Survives a fresh request — not just the extraction response.
    const listed = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` });
    expect(listed.json()).toHaveLength(1);
  });

  it('returns a successful empty state when the model proposes nothing', async () => {
    const { app } = await appWith({ candidates: [] });
    const repo = await makeRepo();

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates).toEqual([]);
  });

  it('a malformed model response produces a controlled error and persists nothing', async () => {
    const { app } = await appWith({ candidates: [{ nonsense: true }] });
    const repo = await makeRepo();

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.json().error).toBeDefined();
    expect(res.json().error.message).not.toMatch(/nonsense/); // no raw model text leaked

    const listed = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` });
    expect(listed.json()).toEqual([]);
  });

  it('resolves the model from Settings → Feature Models, not a hardcoded constant', async () => {
    await pg.handle.db.insert(t.settings).values({
      workspaceId,
      key: 'feature_models',
      value: { conventions: { provider: 'openai', model: 'test-cheap-model-x' } },
    });
    const { app } = await appWith();
    const repo = await makeRepo();

    const res = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    expect(res.json().model).toBe('test-cheap-model-x');
  });

  it('accept/reject/edit persist, and a re-scan neither loses decisions nor re-proposes a rejected rule', async () => {
    const { app } = await appWith();
    const repo = await makeRepo();

    const first = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const candidateId = first.json().candidates[0].id as string;

    // Accept persists.
    const approve = await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidateId}`,
      payload: { status: 'approved' },
    });
    expect(approve.json().status).toBe('approved');

    // Inline edit persists.
    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidateId}`,
      payload: { rule: 'Prefer async/await for asynchronous database calls.' },
    });
    expect(edited.json().rule).toBe('Prefer async/await for asynchronous database calls.');

    // Re-scan with the SAME fixture must not duplicate or disturb the decision.
    const rescan = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const afterRescan = rescan.json().candidates;
    expect(afterRescan).toHaveLength(1);
    expect(afterRescan[0].id).toBe(candidateId);
    expect(afterRescan[0].status).toBe('approved');
    expect(afterRescan[0].rule).toBe('Prefer async/await for asynchronous database calls.');

    // Reject persists and survives reload.
    const reject = await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidateId}`,
      payload: { status: 'rejected' },
    });
    expect(reject.json().status).toBe('rejected');

    const rescan2 = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const afterRescan2 = rescan2.json().candidates;
    // Still exactly one row, still rejected — not re-proposed as pending.
    expect(afterRescan2).toHaveLength(1);
    expect(afterRescan2[0].status).toBe('rejected');

    const reloaded = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions` });
    expect(reloaded.json()).toHaveLength(1);
    expect(reloaded.json()[0].status).toBe('rejected');
  });

  it('refuses to build a skill draft or create a skill with zero approved candidates', async () => {
    const { app } = await appWith();
    const repo = await makeRepo();
    await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });

    const draft = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions/skill-draft` });
    expect(draft.statusCode).toBe(422);

    const create = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill`,
      payload: { name: 'repo-conventions', description: 'x', body: '# x', convention_ids: [] },
    });
    expect(create.statusCode).toBe(422);
  });

  it('creates the repo-conventions skill from approved candidates, using the user-edited body verbatim, and it is visible via the Skills API', async () => {
    await clearConventionsSkill();
    const { app } = await appWith();
    const repo = await makeRepo();
    const extract = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const candidateId = extract.json().candidates[0].id as string;

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidateId}`,
      payload: { status: 'approved' },
    });

    const draftRes = await app.inject({ method: 'GET', url: `/repos/${repo.id}/conventions/skill-draft` });
    const draft = draftRes.json();
    expect(draft.name).toBe('repo-conventions');
    expect(draft.existing_skill_id).toBeNull();

    const editedBody = `${draft.body}\n\n(edited by the user before saving)`;
    const create = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill`,
      payload: {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        enabled: true,
        body: editedBody,
        convention_ids: draft.convention_ids,
      },
    });
    expect(create.statusCode).toBe(201);
    const skill = create.json();
    expect(skill.name).toBe('repo-conventions');
    expect(skill.body).toBe(editedBody); // verbatim, not silently regenerated
    expect(skill.enabled).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.json().some((s: { id: string }) => s.id === skill.id)).toBe(true);
  });

  it('reports a conflict for an existing skill name and versions it only on explicit confirmation', async () => {
    await clearConventionsSkill();
    const { app } = await appWith();
    const repo = await makeRepo();

    const manual = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'repo-conventions',
        description: 'hand-authored',
        type: 'convention',
        body: '# hand-authored body',
        enabled: true,
      },
    });
    const existingSkillId = manual.json().id as string;

    const extract = await app.inject({ method: 'POST', url: `/repos/${repo.id}/conventions/extract` });
    const candidateId = extract.json().candidates[0].id as string;
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidateId}`,
      payload: { status: 'approved' },
    });

    const conflict = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill`,
      payload: {
        name: 'repo-conventions',
        description: 'from conventions',
        body: '# generated body',
        convention_ids: [candidateId],
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details.existing_skill_id).toBe(existingSkillId);

    const replace = await app.inject({
      method: 'POST',
      url: `/repos/${repo.id}/conventions/skill`,
      payload: {
        name: 'repo-conventions',
        description: 'from conventions',
        body: '# generated body v2',
        convention_ids: [candidateId],
        replace_skill_id: existingSkillId,
      },
    });
    expect(replace.statusCode).toBe(200);
    expect(replace.json().id).toBe(existingSkillId);
    expect(replace.json().body).toBe('# generated body v2');
    expect(replace.json().version).toBe(2); // body change bumped the version
  });
});
