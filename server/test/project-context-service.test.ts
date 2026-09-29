/**
 * ProjectContextService — hermetic. No Postgres, no filesystem, no network.
 *
 * What is under test is the use-case WIRING the pure helpers cannot prove:
 *   - sync stores snapshots + token counts from the injected tokenizer (NFR-5),
 *   - a re-sync marks a vanished repo document `missing` (never deletes it) and
 *     leaves a user-authored document at the same path alone (FR-17/D-8),
 *   - "no clone" keeps every stored snapshot and reports failed/no_clone (NFR-4),
 *   - a scan past the bound reports `bounded` rather than a silent partial list,
 *   - `effectiveSetForRun` skips a `missing` document but still records it (FR-16),
 *   - crossing the token threshold warns and never refuses a write (D-3).
 *
 * The document scan is mocked AT THE PORT with `MockDocSource`. The repository
 * is replaced on the service with an in-memory fake that keeps the one
 * repository contract the service leans on — rows keyed `(repo, origin, path)`
 * — the same seam `intent-service.test.ts` uses. That the real SQL honours the
 * same key is what `project-context.it.test.ts` proves against Postgres.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ProjectDocFile } from '@devdigest/shared';
import { CONTEXT_TOKEN_BUDGET } from '@devdigest/shared';
import type { Container } from '../src/platform/container.js';
import type { ContextDocumentRow, ContextSyncStateRow } from '../src/db/rows.js';
import { MockDocSource } from '../src/adapters/mocks.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import type {
  UpsertRepoDocument,
  UpsertSyncState,
} from '../src/modules/project-context/repository.js';
import { ConflictError, ValidationError } from '../src/platform/errors.js';
import { MAX_DOCS_PER_REPO } from '../src/modules/project-context/constants.js';

const WS = 'ws-1';
const REPO = 'repo-1';
const AGENT = 'agent-1';

/** In-memory stand-in for ProjectContextRepository — only what the service calls. */
class FakeRepo {
  docs: ContextDocumentRow[] = [];
  state: ContextSyncStateRow | null = null;
  links = new Map<string, string[]>(); // `${kind}:${owner}:${repo}` → ordered ids
  markedMissing: string[][] = [];

  async listDocuments(workspaceId: string, repoId: string) {
    return this.docs
      .filter((d) => d.workspaceId === workspaceId && d.repoId === repoId)
      .map(({ content: _c, ...rest }) => ({ ...rest, usedByAgents: 0 }));
  }
  async getDocument(workspaceId: string, repoId: string, id: string) {
    return this.docs.find((d) => d.workspaceId === workspaceId && d.repoId === repoId && d.id === id) ?? null;
  }
  async documentsByIds(workspaceId: string, repoId: string, ids: string[]) {
    return this.docs.filter((d) => d.workspaceId === workspaceId && d.repoId === repoId && ids.includes(d.id));
  }
  async idsInRepo(workspaceId: string, repoId: string, ids: string[]) {
    return (await this.documentsByIds(workspaceId, repoId, ids)).map((d) => d.id);
  }
  async upsertRepoDocument(input: UpsertRepoDocument) {
    const existing = this.docs.find(
      (d) => d.repoId === input.repoId && d.origin === 'repo' && d.path === input.path,
    );
    if (existing) {
      Object.assign(existing, input, { availability: 'present', updatedAt: new Date() });
      return;
    }
    this.docs.push({ ...input, id: randomUUID(), origin: 'repo', availability: 'present', updatedAt: new Date() });
  }
  async insertUserDocument(input: UpsertRepoDocument) {
    if (this.docs.some((d) => d.repoId === input.repoId && d.origin === 'user' && d.path === input.path)) {
      return null;
    }
    const row: ContextDocumentRow = {
      ...input,
      id: randomUUID(),
      origin: 'user',
      availability: 'present',
      updatedAt: new Date(),
    };
    this.docs.push(row);
    return row;
  }
  async markMissing(repoId: string, ids: string[]) {
    this.markedMissing.push(ids);
    for (const d of this.docs) if (d.repoId === repoId && ids.includes(d.id)) d.availability = 'missing';
  }
  async listRepoDocumentPaths(repoId: string) {
    return this.docs
      .filter((d) => d.repoId === repoId && d.origin === 'repo')
      .map((d) => ({ id: d.id, path: d.path, fingerprint: d.fingerprint }));
  }
  async deleteUserDocument() {
    return true;
  }
  async getSyncState() {
    return this.state;
  }
  async upsertSyncState(input: UpsertSyncState) {
    this.state = { ...input };
  }
  async countDocuments(repoId: string) {
    return this.docs.filter((d) => d.repoId === repoId).length;
  }
  async attachedIds(kind: string, ownerId: string, repoId: string) {
    return this.links.get(`${kind}:${ownerId}:${repoId}`) ?? [];
  }
  async attachmentsForSkills(skillIds: string[], repoId: string) {
    const out = new Map<string, string[]>();
    for (const id of skillIds) {
      const list = this.links.get(`skill:${id}:${repoId}`);
      if (list) out.set(id, list);
    }
    return out;
  }
  async replaceAttachments(kind: string, ownerId: string, repoId: string, ids: string[]) {
    this.links.set(`${kind}:${ownerId}:${repoId}`, ids);
  }
}

function file(path: string, content: string): ProjectDocFile {
  return { path, content, sizeBytes: Buffer.byteLength(content) };
}

function build(docSource: MockDocSource, linkedSkills: { id: string; enabled: boolean; order: number }[] = []) {
  const container = {
    db: {},
    docSource,
    // A deterministic counter so the stored count is checkable without tiktoken.
    tokenizer: { count: (text: string) => text.length },
    reposRepo: {
      async getById(workspaceId: string, repoId: string) {
        return workspaceId === WS && repoId === REPO ? { id: REPO, owner: 'acme', name: 'api' } : undefined;
      },
    },
    agentsRepo: {
      async linkedSkills() {
        return linkedSkills.map((s) => ({ order: s.order, skill: { id: s.id, enabled: s.enabled } }));
      },
    },
  } as unknown as Container;
  const service = new ProjectContextService(container);
  const repo = new FakeRepo();
  (service as unknown as { repo: FakeRepo }).repo = repo;
  return { service, repo };
}

describe('ProjectContextService.sync', () => {
  it('stores discovered documents with snapshots and token counts, and ignores non-convention paths', async () => {
    const source = new MockDocSource({
      files: [
        file('.devdigest/specs/api.md', '# API spec'),
        file('.devdigest/docs/guide/setup.md', '# Setup'),
        file('README.md', '# not a document'),
      ],
    });
    const { service, repo } = build(source);

    const status = await service.sync(WS, REPO);

    expect(status).toMatchObject({ document_count: 2, health: 'fresh', reason: null });
    const api = repo.docs.find((d) => d.path === '.devdigest/specs/api.md')!;
    expect(api).toMatchObject({
      origin: 'repo',
      category: 'specs',
      content: '# API spec',
      tokenCount: '# API spec'.length,
      availability: 'present',
    });
    expect(repo.docs.find((d) => d.path === '.devdigest/docs/guide/setup.md')?.folder).toBe('guide');
    expect(repo.docs.some((d) => d.path === 'README.md')).toBe(false);
  });

  it('marks a vanished repo document missing without deleting it, and never touches a user document at the same path (D-8)', async () => {
    const source = new MockDocSource({ files: [file('.devdigest/specs/x.md', 'repo body')] });
    const { service, repo } = build(source);

    const userDoc = await service.createDocument(WS, REPO, {
      category: 'specs',
      folder: '',
      name: 'x.md',
      body: 'user body',
    });
    await service.sync(WS, REPO);

    // Two documents, one path, two origins.
    const atPath = repo.docs.filter((d) => d.path === '.devdigest/specs/x.md');
    expect(atPath.map((d) => d.origin).sort()).toEqual(['repo', 'user']);
    expect(atPath.find((d) => d.origin === 'user')!.content).toBe('user body');

    // The file disappears upstream.
    source.setFiles([]);
    await service.sync(WS, REPO);

    const repoDoc = repo.docs.find((d) => d.path === '.devdigest/specs/x.md' && d.origin === 'repo')!;
    const user = repo.docs.find((d) => d.id === userDoc.id)!;
    expect(repoDoc.availability).toBe('missing');
    expect(repoDoc.content).toBe('repo body'); // snapshot kept
    expect(user).toMatchObject({ availability: 'present', content: 'user body' });
    expect(repo.markedMissing.flat()).not.toContain(userDoc.id);
  });

  it('with no clone, keeps every stored snapshot and reports failed / no_clone (NFR-4)', async () => {
    const source = new MockDocSource({ files: [file('.devdigest/specs/a.md', 'A')] });
    const { service, repo } = build(source);
    await service.sync(WS, REPO);

    const unavailable = new MockDocSource({ available: false });
    (service as unknown as { container: { docSource: MockDocSource } }).container.docSource = unavailable;
    const status = await service.sync(WS, REPO);

    expect(status).toMatchObject({ health: 'failed', reason: 'no_clone', document_count: 1 });
    expect(repo.docs).toHaveLength(1);
    expect(repo.docs[0]).toMatchObject({ availability: 'present', content: 'A' });
    expect(repo.markedMissing.flat()).toHaveLength(0);
  });

  it('reports `bounded` with the dropped count when the scan exceeded the document bound', async () => {
    const source = new MockDocSource({ files: [file('.devdigest/specs/a.md', 'A')], bounded: 7 });
    const { service } = build(source);

    const status = await service.sync(WS, REPO);

    expect(status.health).toBe('bounded');
    expect(status.reason).toBe(`bounded:7:${MAX_DOCS_PER_REPO}`);
  });
});

describe('ProjectContextService intake', () => {
  it('rejects an invalid upload with the reason and a duplicate user path as a conflict', async () => {
    const { service } = build(new MockDocSource());

    await expect(
      service.createDocument(WS, REPO, { category: 'specs', folder: '', name: 'a.pdf', body: 'x' }),
    ).rejects.toThrow(ValidationError);

    await service.createDocument(WS, REPO, { category: 'specs', folder: '', name: 'a.md', body: 'x' });
    await expect(
      service.createDocument(WS, REPO, { category: 'specs', folder: '', name: 'a.md', body: 'y' }),
    ).rejects.toThrow(ConflictError);
  });

  it('refuses to delete a repo-discovered document', async () => {
    const { service, repo } = build(new MockDocSource({ files: [file('.devdigest/specs/a.md', 'A')] }));
    await service.sync(WS, REPO);
    await expect(service.deleteDocument(WS, REPO, repo.docs[0]!.id)).rejects.toThrow(ValidationError);
  });
});

describe('ProjectContextService attachments + run set', () => {
  it('effectiveSetForRun skips a missing document but records it, keeping the rest in merged order (FR-16)', async () => {
    const source = new MockDocSource({
      files: [file('.devdigest/specs/a.md', 'A body'), file('.devdigest/specs/b.md', 'B body')],
    });
    const { service, repo } = build(source);
    await service.sync(WS, REPO);
    const a = repo.docs.find((d) => d.name === 'a.md')!;
    const b = repo.docs.find((d) => d.name === 'b.md')!;
    await service.setAttachments('agent', AGENT, REPO, WS, [b.id, a.id]);

    source.setFiles([file('.devdigest/specs/a.md', 'A body')]); // b vanishes
    await service.sync(WS, REPO);

    const run = await service.effectiveSetForRun(WS, REPO, AGENT, []);
    expect(run.texts).toEqual(['.devdigest/specs/a.md\n\nA body']);
    expect(run.read).toEqual([
      { path: '.devdigest/specs/b.md', origin: 'repo', status: 'missing' },
      { path: '.devdigest/specs/a.md', origin: 'repo', status: 'injected' },
    ]);
  });

  it('an agent with nothing attached yields an empty set, not an error (FR-8)', async () => {
    const { service } = build(new MockDocSource());
    expect(await service.effectiveSetForRun(WS, REPO, AGENT, [])).toEqual({ texts: [], read: [] });
  });

  it('crossing the token threshold flags over_budget and still saves (D-3)', async () => {
    const big = 'x'.repeat(CONTEXT_TOKEN_BUDGET); // counter = length → exactly the budget
    const { service, repo } = build(
      new MockDocSource({
        files: [file('.devdigest/specs/big.md', big), file('.devdigest/specs/small.md', 'tiny')],
      }),
    );
    await service.sync(WS, REPO);
    const bigId = repo.docs.find((d) => d.name === 'big.md')!.id;
    const smallId = repo.docs.find((d) => d.name === 'small.md')!.id;

    const atBudget = await service.setAttachments('agent', AGENT, REPO, WS, [bigId]);
    expect(atBudget.over_budget).toBe(false);

    const over = await service.setAttachments('agent', AGENT, REPO, WS, [bigId, smallId]);
    expect(over.total_tokens).toBe(CONTEXT_TOKEN_BUDGET + 4);
    expect(over.over_budget).toBe(true);
    expect(over.budget_threshold).toBe(CONTEXT_TOKEN_BUDGET);
    expect(over.documents.map((d) => d.document.id)).toEqual([bigId, smallId]);
  });

  it('rejects a document id from outside the repository instead of half-applying the write', async () => {
    const { service, repo } = build(new MockDocSource({ files: [file('.devdigest/specs/a.md', 'A')] }));
    await service.sync(WS, REPO);
    const foreign = randomUUID();
    await expect(
      service.setAttachments('agent', AGENT, REPO, WS, [repo.docs[0]!.id, foreign]),
    ).rejects.toThrow(ValidationError);
    expect(await repo.attachedIds('agent', AGENT, REPO)).toEqual([]);
  });

  it("an agent's set merges in only its ENABLED skills' documents, with provenance", async () => {
    const { service, repo } = build(
      new MockDocSource({
        files: [
          file('.devdigest/specs/direct.md', 'D'),
          file('.devdigest/specs/shared.md', 'S'),
          file('.devdigest/specs/on.md', 'ON'),
          file('.devdigest/specs/off.md', 'OFF'),
        ],
      }),
      [
        { id: 'skill-on', enabled: true, order: 0 },
        { id: 'skill-off', enabled: false, order: 1 },
      ],
    );
    await service.sync(WS, REPO);
    const id = (name: string) => repo.docs.find((d) => d.name === name)!.id;
    await service.setAttachments('skill', 'skill-on', REPO, WS, [id('on.md'), id('shared.md')]);
    await service.setAttachments('skill', 'skill-off', REPO, WS, [id('off.md')]);

    const set = await service.setAttachments('agent', AGENT, REPO, WS, [id('direct.md'), id('shared.md')]);

    expect(set.documents.map((d) => [d.document.name, d.provenance])).toEqual([
      ['direct.md', 'direct'],
      ['shared.md', 'both'],
      ['on.md', 'inherited'],
    ]);
  });
});
