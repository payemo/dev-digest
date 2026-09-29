/**
 * Project Context routes + repository — DB-backed, against a real Postgres via
 * testcontainers. Self-skips without Docker.
 *
 * What only a real database can prove:
 *   - attachment order round-trips through the link tables and is per-repo
 *     (FR-5/FR-6/FR-8);
 *   - path coexistence (FR-17/D-8): a user-authored and a repo-discovered
 *     document at the same path are two rows, separately attachable, and
 *     re-sync / delete of one never touches the other — AND the unique index
 *     `(repo_id, origin, path)` enforces it at the database level;
 *   - skill inheritance + dedupe (FR-7/FR-9) through the real SQL, and that
 *     disabling the skill drops only the inherited-only documents;
 *   - `used_by_agents`'s correlated subquery counts agents, not links (FR-14);
 *   - tenancy: an unknown repo 404s, a foreign document id is refused.
 *
 * The document scan is mocked at the port (`MockDocSource`); nothing touches a
 * clone on disk.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockDocSource, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { ContextAttachmentSet, ContextDocument, ProjectDocFile } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function file(path: string, content: string): ProjectDocFile {
  return { path, content, sizeBytes: Buffer.byteLength(content) };
}

d('project context (Testcontainers pg)', () => {
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

  let repoSeq = 0;
  async function makeRepo() {
    const name = `ctx-repo-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!;
  }

  async function appWith(source: MockDocSource) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient(), docSource: source },
    });
  }
  type App = Awaited<ReturnType<typeof appWith>>;

  async function makeAgent(app: App) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Ctx Agent ${randomUUID().slice(0, 8)}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You review.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function makeSkill(app: App) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `Ctx Skill ${randomUUID().slice(0, 8)}`,
        description: 'd',
        type: 'rubric',
        body: '- rule',
        enabled: true,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function listDocs(app: App, repoId: string): Promise<ContextDocument[]> {
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/documents` });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function putAttachments(app: App, repoId: string, kind: 'agents' | 'skills', owner: string, ids: string[]) {
    return app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/context/${kind}/${owner}/attachments`,
      payload: { document_ids: ids },
    });
  }

  async function getAttachments(app: App, repoId: string, kind: 'agents' | 'skills', owner: string) {
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context/${kind}/${owner}/attachments` });
    expect(res.statusCode).toBe(200);
    return res.json() as ContextAttachmentSet;
  }

  it('attach round-trip: reorder persists across a reload, and the same agent under another repo has nothing attached', async () => {
    const source = new MockDocSource({
      files: [file('.devdigest/specs/a.md', '# A'), file('.devdigest/docs/b.md', '# B')],
    });
    const app = await appWith(source);
    const r = await makeRepo();
    const r2 = await makeRepo();
    const agent = await makeAgent(app);

    const refresh = await app.inject({ method: 'POST', url: `/repos/${r.id}/context/refresh` });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({ document_count: 2, health: 'fresh' });

    const docs = await listDocs(app, r.id);
    const a = docs.find((x) => x.name === 'a.md')!;
    const b = docs.find((x) => x.name === 'b.md')!;

    expect((await putAttachments(app, r.id, 'agents', agent.id, [a.id, b.id])).statusCode).toBe(200);
    expect((await putAttachments(app, r.id, 'agents', agent.id, [b.id, a.id])).statusCode).toBe(200);

    // A fresh app instance = a reload; nothing is cached between them.
    const reloaded = await appWith(source);
    const set = await getAttachments(reloaded, r.id, 'agents', agent.id);
    expect(set.documents.map((x) => x.document.name)).toEqual(['b.md', 'a.md']);
    expect(set.documents.every((x) => x.provenance === 'direct')).toBe(true);

    const other = await getAttachments(reloaded, r2.id, 'agents', agent.id);
    expect(other.documents).toEqual([]);
    expect(other.total_tokens).toBe(0);
  });

  it('path coexistence (D-8): a user document and a repo document at one path are independent', async () => {
    const source = new MockDocSource({ files: [file('.devdigest/specs/x.md', 'REPO BODY')] });
    const app = await appWith(source);
    const r = await makeRepo();
    const agent = await makeAgent(app);

    const created = await app.inject({
      method: 'POST',
      url: `/repos/${r.id}/context/documents`,
      payload: { category: 'specs', folder: '', name: 'x.md', body: 'USER BODY' },
    });
    expect(created.statusCode).toBe(201);
    const userDoc = created.json() as ContextDocument;
    expect(userDoc).toMatchObject({ origin: 'user', path: '.devdigest/specs/x.md' });

    await app.inject({ method: 'POST', url: `/repos/${r.id}/context/refresh` });

    const docs = await listDocs(app, r.id);
    const atPath = docs.filter((x) => x.path === '.devdigest/specs/x.md');
    expect(atPath.map((x) => x.origin).sort()).toEqual(['repo', 'user']);
    const repoDoc = atPath.find((x) => x.origin === 'repo')!;
    expect(repoDoc.id).not.toBe(userDoc.id);

    // Separately attachable, and attaching both puts both bodies in the run set.
    expect((await putAttachments(app, r.id, 'agents', agent.id, [userDoc.id, repoDoc.id])).statusCode).toBe(200);
    const run = await app.container.projectContext.effectiveSetForRun(workspaceId, r.id, agent.id, []);
    expect(run.texts).toEqual([
      '.devdigest/specs/x.md\n\nUSER BODY',
      '.devdigest/specs/x.md\n\nREPO BODY',
    ]);

    // Refresh with changed content: only the repo row changes.
    source.setFiles([file('.devdigest/specs/x.md', 'REPO BODY v2')]);
    await app.inject({ method: 'POST', url: `/repos/${r.id}/context/refresh` });
    const userAfterUpdate = (
      await app.inject({ method: 'GET', url: `/repos/${r.id}/context/documents/${userDoc.id}` })
    ).json();
    expect(userAfterUpdate.content).toBe('USER BODY');
    const repoAfterUpdate = (
      await app.inject({ method: 'GET', url: `/repos/${r.id}/context/documents/${repoDoc.id}` })
    ).json();
    expect(repoAfterUpdate.content).toBe('REPO BODY v2');

    // Removing the repo file marks only the repo-origin row missing.
    source.setFiles([]);
    await app.inject({ method: 'POST', url: `/repos/${r.id}/context/refresh` });
    const afterRemoval = await listDocs(app, r.id);
    expect(afterRemoval.find((x) => x.id === repoDoc.id)?.availability).toBe('missing');
    expect(afterRemoval.find((x) => x.id === userDoc.id)?.availability).toBe('present');

    // A repo-discovered document cannot be deleted; deleting the user one leaves the repo row.
    const refused = await app.inject({ method: 'DELETE', url: `/repos/${r.id}/context/documents/${repoDoc.id}` });
    expect(refused.statusCode).toBe(422);
    const deleted = await app.inject({ method: 'DELETE', url: `/repos/${r.id}/context/documents/${userDoc.id}` });
    expect(deleted.statusCode).toBe(204);
    const finalDocs = await listDocs(app, r.id);
    expect(finalDocs.map((x) => x.id)).toEqual([repoDoc.id]);

    // The surviving attachment is the repo one; the user one cascaded away.
    const set = await getAttachments(app, r.id, 'agents', agent.id);
    expect(set.documents.map((x) => x.document.id)).toEqual([repoDoc.id]);

    // A second user document at the same path is a conflict, not an overwrite.
    await app.inject({
      method: 'POST',
      url: `/repos/${r.id}/context/documents`,
      payload: { category: 'specs', folder: '', name: 'y.md', body: 'first' },
    });
    const dup = await app.inject({
      method: 'POST',
      url: `/repos/${r.id}/context/documents`,
      payload: { category: 'specs', folder: '', name: 'y.md', body: 'second' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('the unique index (repo_id, origin, path) enforces coexistence at the database level', async () => {
    const r = await makeRepo();
    const row = (origin: 'repo' | 'user') => ({
      workspaceId,
      repoId: r.id,
      path: '.devdigest/specs/same.md',
      name: 'same.md',
      folder: '',
      category: 'specs' as const,
      origin,
      content: origin,
      sizeBytes: 4,
      fingerprint: origin,
    });

    await pg.handle.db.insert(t.contextDocuments).values(row('repo'));
    await pg.handle.db.insert(t.contextDocuments).values(row('user'));

    // Same (repo, origin, path) twice — the database itself refuses it.
    await expect(pg.handle.db.insert(t.contextDocuments).values(row('user'))).rejects.toThrow(
      /context_documents_repo_origin_path_uq|duplicate key/,
    );
    await expect(pg.handle.db.insert(t.contextDocuments).values(row('repo'))).rejects.toThrow(
      /context_documents_repo_origin_path_uq|duplicate key/,
    );

    // Same path + origin in a DIFFERENT repo is fine.
    const other = await makeRepo();
    await pg.handle.db.insert(t.contextDocuments).values({ ...row('user'), repoId: other.id });

    const stored = await pg.handle.db
      .select({ origin: t.contextDocuments.origin })
      .from(t.contextDocuments)
      .where(and(eq(t.contextDocuments.repoId, r.id), eq(t.contextDocuments.path, '.devdigest/specs/same.md')));
    expect(stored.map((s) => s.origin).sort()).toEqual(['repo', 'user']);
  });

  it('skill inheritance: a both-ways document appears once at its direct position; disabling the skill drops only inherited-only documents', async () => {
    const source = new MockDocSource({
      files: [
        file('.devdigest/specs/direct.md', 'D'),
        file('.devdigest/specs/shared.md', 'S'),
        file('.devdigest/specs/inherited.md', 'I'),
      ],
    });
    const app = await appWith(source);
    const r = await makeRepo();
    const agent = await makeAgent(app);
    const skill = await makeSkill(app);
    await app.inject({ method: 'POST', url: `/repos/${r.id}/context/refresh` });
    const id = async (name: string) => (await listDocs(app, r.id)).find((x) => x.name === name)!.id;

    await app.inject({ method: 'POST', url: `/agents/${agent.id}/skills`, payload: { skill_ids: [skill.id] } });
    expect(
      (await putAttachments(app, r.id, 'skills', skill.id, [await id('inherited.md'), await id('shared.md')])).statusCode,
    ).toBe(200);
    expect(
      (await putAttachments(app, r.id, 'agents', agent.id, [await id('shared.md'), await id('direct.md')])).statusCode,
    ).toBe(200);

    const merged = await getAttachments(app, r.id, 'agents', agent.id);
    expect(merged.documents.map((x) => [x.document.name, x.provenance])).toEqual([
      ['shared.md', 'both'],
      ['direct.md', 'direct'],
      ['inherited.md', 'inherited'],
    ]);

    // The skill's own view is only its own list.
    const skillSet = await getAttachments(app, r.id, 'skills', skill.id);
    expect(skillSet.documents.map((x) => x.document.name)).toEqual(['inherited.md', 'shared.md']);

    const disabled = await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    expect(disabled.statusCode).toBe(200);

    const after = await getAttachments(app, r.id, 'agents', agent.id);
    expect(after.documents.map((x) => [x.document.name, x.provenance])).toEqual([
      ['shared.md', 'direct'],
      ['direct.md', 'direct'],
    ]);
  });

  it('used_by_agents counts each enabled agent once, whether it reaches a document directly, via a skill, or both', async () => {
    const source = new MockDocSource({ files: [file('.devdigest/specs/x.md', 'X'), file('.devdigest/specs/y.md', 'Y')] });
    const app = await appWith(source);
    const r = await makeRepo();
    await app.inject({ method: 'POST', url: `/repos/${r.id}/context/refresh` });
    const docs = await listDocs(app, r.id);
    const x = docs.find((d) => d.name === 'x.md')!;

    const direct = await makeAgent(app);
    const viaSkill = await makeAgent(app);
    const bothWays = await makeAgent(app);
    const skill = await makeSkill(app);

    await putAttachments(app, r.id, 'skills', skill.id, [x.id]);
    await putAttachments(app, r.id, 'agents', direct.id, [x.id]);
    await app.inject({ method: 'POST', url: `/agents/${viaSkill.id}/skills`, payload: { skill_ids: [skill.id] } });
    await app.inject({ method: 'POST', url: `/agents/${bothWays.id}/skills`, payload: { skill_ids: [skill.id] } });
    await putAttachments(app, r.id, 'agents', bothWays.id, [x.id]);

    const listed = await listDocs(app, r.id);
    expect(listed.find((d) => d.name === 'x.md')!.used_by_agents).toBe(3);
    expect(listed.find((d) => d.name === 'y.md')!.used_by_agents).toBe(0);
  });

  it('tenancy: an unknown repo 404s and a document from another repo cannot be attached', async () => {
    const source = new MockDocSource({ files: [file('.devdigest/specs/a.md', 'A')] });
    const app = await appWith(source);
    const r = await makeRepo();
    const r2 = await makeRepo();
    const agent = await makeAgent(app);
    await app.inject({ method: 'POST', url: `/repos/${r2.id}/context/refresh` });
    const foreignDoc = (await listDocs(app, r2.id))[0]!;

    const missingRepo = randomUUID();
    expect((await app.inject({ method: 'GET', url: `/repos/${missingRepo}/context/documents` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/repos/${missingRepo}/context/status` })).statusCode).toBe(404);
    expect((await putAttachments(app, missingRepo, 'agents', agent.id, [])).statusCode).toBe(404);

    const res = await putAttachments(app, r.id, 'agents', agent.id, [foreignDoc.id]);
    expect(res.statusCode).toBe(422);
    expect((await getAttachments(app, r.id, 'agents', agent.id)).documents).toEqual([]);
  });

  it('intake bounds: a non-Markdown upload and an oversized one are rejected with a reason', async () => {
    const app = await appWith(new MockDocSource());
    const r = await makeRepo();

    const nonMd = await app.inject({
      method: 'POST',
      url: `/repos/${r.id}/context/documents`,
      payload: { category: 'docs', folder: '', name: 'notes.txt', body: 'x' },
    });
    expect(nonMd.statusCode).toBe(422);
    expect(nonMd.json().error.message).toMatch(/markdown/i);

    const big = await app.inject({
      method: 'POST',
      url: `/repos/${r.id}/context/documents`,
      payload: { category: 'docs', folder: '', name: 'big.md', body: 'x'.repeat(300_000) },
    });
    expect(big.statusCode).toBe(422);
    expect(big.json().error.message).toMatch(/at most/i);

    const traversal = await app.inject({
      method: 'POST',
      url: `/repos/${r.id}/context/documents`,
      payload: { category: 'docs', folder: '../../..', name: 'x.md', body: 'x' },
    });
    expect(traversal.statusCode).toBe(422);
    expect(await listDocs(app, r.id)).toEqual([]);
  });
});
