/**
 * Export to CI — the GitHub Actions side of `OctokitGitHubClient` and the
 * local runner-bundle source (spec 05, I7 and the scope-error mapping).
 *
 * The Octokit REST client is replaced with a stub object (the constructor only
 * takes a token — same seam as `github-linked-issue.test.ts`); the artifact
 * download is a raw `fetch`, stubbed globally. No network, no real token.
 *
 * Kinds of breakage covered: a "workflow not on the default branch yet" 404
 * being reported as an error (or a real missing-scope 404 being swallowed as
 * "no runs"), a zip bomb / oversized artifact being buffered or inflated, the
 * wrong zip entry being read, re-grounding inputs throwing instead of
 * degrading, the token leaking into an error message, and the studio shipping
 * a stale runner bundle after a rebuild.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { ArtifactTooLargeError } from '@devdigest/shared';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';
import { LocalRunnerBundleSource } from '../src/adapters/runner-bundle/local.js';
import { ExternalServiceError } from '../src/platform/errors.js';

const TOKEN = 'ghp_SUPERSECRETTOKEN123';
const REPO = { owner: 'acme', name: 'api' };
const WF = '.github/workflows/devdigest-review-sec.yml';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

interface Stub {
  listWorkflowRuns?: (args: Record<string, unknown>) => Promise<unknown>;
  reposGet?: () => Promise<unknown>;
  getContent?: (args: { path: string; ref: string }) => Promise<unknown>;
  pullsGet?: () => Promise<unknown>;
  compare?: () => Promise<unknown>;
}

function clientWith(stub: Stub) {
  const calls: Record<string, unknown[]> = { listWorkflowRuns: [], getContent: [] };
  const octokit = {
    rest: {
      actions: {
        listWorkflowRuns: async (args: Record<string, unknown>) => {
          calls.listWorkflowRuns!.push(args);
          return stub.listWorkflowRuns!(args);
        },
      },
      repos: {
        get: async () => stub.reposGet!(),
        getContent: async (args: { path: string; ref: string }) => {
          calls.getContent!.push(args);
          return stub.getContent!(args);
        },
        compareCommitsWithBasehead: async () => stub.compare!(),
      },
      pulls: { get: async () => stub.pullsGet!() },
    },
  };
  const client = new OctokitGitHubClient(TOKEN);
  (client as unknown as { octokit: unknown }).octokit = octokit;
  return { client, calls };
}

async function errorOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

describe('listWorkflowRuns', () => {
  it('lists pull_request runs of the workflow file by basename and maps them', async () => {
    const { client, calls } = clientWith({
      listWorkflowRuns: async () => ({
        data: {
          workflow_runs: [
            {
              id: 5,
              run_attempt: 2,
              html_url: 'https://github.com/acme/api/actions/runs/5',
              event: 'pull_request',
              status: 'completed',
              conclusion: 'failure',
              head_sha: 'abc',
              path: WF,
              repository: { full_name: 'acme/api' },
              head_repository: null,
              pull_requests: [{ number: 7 }],
              created_at: '2026-10-01T00:00:00Z',
              run_started_at: null,
              updated_at: '2026-10-01T00:01:00Z',
            },
          ],
        },
      }),
    });
    const runs = await client.listWorkflowRuns(REPO, WF, { perPage: 30 });
    expect(calls.listWorkflowRuns![0]).toMatchObject({
      workflow_id: 'devdigest-review-sec.yml',
      event: 'pull_request',
      per_page: 30,
    });
    expect(runs).toEqual([
      {
        id: 5,
        run_attempt: 2,
        html_url: 'https://github.com/acme/api/actions/runs/5',
        event: 'pull_request',
        status: 'completed',
        conclusion: 'failure',
        head_sha: 'abc',
        path: WF,
        repository_full_name: 'acme/api',
        head_repository_full_name: null,
        pull_numbers: [7],
        created_at: '2026-10-01T00:00:00Z',
        run_started_at: null,
        updated_at: '2026-10-01T00:01:00Z',
      },
    ]);
  });

  it('treats a 404 as "no runs yet" only when the workflow file is confirmed absent on the default branch', async () => {
    const { client, calls } = clientWith({
      listWorkflowRuns: async () => Promise.reject(httpError(404)),
      reposGet: async () => ({ data: { default_branch: 'trunk' } }),
      getContent: async () => Promise.reject(httpError(404)),
    });
    expect(await client.listWorkflowRuns(REPO, WF, { perPage: 30 })).toEqual([]);
    expect(calls.getContent![0]).toMatchObject({ path: WF, ref: 'trunk' });
  });

  it.each([
    ['the file exists (the token cannot see Actions)', { getContent: async () => ({ data: { type: 'file' } }) }, 'Actions: read'],
    ['the repo itself 404s', { reposGet: async () => Promise.reject(httpError(404)) }, 'Actions: read'],
    ['reading the repo is forbidden', { reposGet: async () => Promise.reject(httpError(403)) }, 'Contents: read'],
  ] as const)('reports a 404 as a scope error when %s', async (_label, extra, scope) => {
    const { client } = clientWith({
      listWorkflowRuns: async () => Promise.reject(httpError(404)),
      reposGet: async () => ({ data: { default_branch: 'main' } }),
      ...extra,
    });
    const err = await errorOf(client.listWorkflowRuns(REPO, WF, { perPage: 30 }));
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.message).toContain(`"${scope}"`);
    expect(err.message).not.toContain(TOKEN);
  });

  it('reports a direct 403 as a missing "Actions: read" scope', async () => {
    const { client } = clientWith({ listWorkflowRuns: async () => Promise.reject(httpError(403)) });
    const err = await errorOf(client.listWorkflowRuns(REPO, WF, { perPage: 30 }));
    expect(err.message).toMatch(/HTTP 403.*"Actions: read"/);
  });
});

describe('getBlobShas / getPullBaseSha / getCompareDiff', () => {
  it('returns the blob sha per path, null for a missing path or a directory, and throws a scope error on 403', async () => {
    const { client } = clientWith({
      getContent: async ({ path: p }) => {
        if (p === 'a.yaml') return { data: { type: 'file', sha: 'sha-a' } };
        if (p === 'dir') return { data: [] };
        throw httpError(404);
      },
    });
    expect(await client.getBlobShas(REPO, 'head', ['a.yaml', 'gone.md', 'dir'])).toEqual({
      'a.yaml': 'sha-a',
      'gone.md': null,
      dir: null,
    });

    const { client: denied } = clientWith({ getContent: async () => Promise.reject(httpError(403)) });
    expect((await errorOf(denied.getBlobShas(REPO, 'head', ['a.yaml']))).message).toContain('"Contents: read"');
  });

  it('degrades re-grounding inputs to null instead of failing the ingest', async () => {
    const ok = clientWith({
      pullsGet: async () => ({ data: { base: { sha: 'base-sha' } } }),
      compare: async () => ({ data: 'diff --git a/x b/x\n' }),
    }).client;
    expect(await ok.getPullBaseSha(REPO, 7)).toBe('base-sha');
    expect(await ok.getCompareDiff(REPO, 'b', 'h', 1000)).toBe('diff --git a/x b/x\n');
    expect(await ok.getCompareDiff(REPO, 'b', 'h', 5)).toBeNull(); // over the cap

    const broken = clientWith({
      pullsGet: async () => Promise.reject(httpError(404)),
      compare: async () => Promise.reject(httpError(403)),
    }).client;
    expect(await broken.getPullBaseSha(REPO, 7)).toBeNull();
    expect(await broken.getCompareDiff(REPO, 'b', 'h', 1000)).toBeNull();
  });
});

describe('downloadArtifactFile', () => {
  const LIMITS = { maxZipBytes: 4096, maxFileBytes: 512 };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const zipOf = (files: Record<string, string>) =>
    zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

  /** A response whose body arrives in chunks and declares no content-length. */
  const streamed = (bytes: Uint8Array, chunk = 1024) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
          c.close();
        },
      }),
      { status: 200 },
    );

  it('returns only the requested entry, authenticating to the artifact endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(zipOf({ 'devdigest-result.json': '{"ok":true}', 'other.txt': 'ignore me' })),
    );
    const client = new OctokitGitHubClient(TOKEN);
    expect(await client.downloadArtifactFile(REPO, 900, 'devdigest-result.json', LIMITS)).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/acme/api/actions/artifacts/900/zip');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('returns null when the zip has no such entry', async () => {
    fetchMock.mockResolvedValue(new Response(zipOf({ 'other.txt': 'x' })));
    expect(await new OctokitGitHubClient(TOKEN).downloadArtifactFile(REPO, 1, 'devdigest-result.json', LIMITS)).toBeNull();
  });

  it('refuses a zip whose declared size is over the cap without reading it', async () => {
    fetchMock.mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-length': String(LIMITS.maxZipBytes + 1) } }),
    );
    await expect(
      new OctokitGitHubClient(TOKEN).downloadArtifactFile(REPO, 1, 'devdigest-result.json', LIMITS),
    ).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });

  it('stops reading a stream that passes the cap (no content-length)', async () => {
    const big = new Uint8Array(LIMITS.maxZipBytes * 3);
    fetchMock.mockResolvedValue(streamed(big));
    await expect(
      new OctokitGitHubClient(TOKEN).downloadArtifactFile(REPO, 1, 'devdigest-result.json', LIMITS),
    ).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });

  it('refuses to inflate an entry whose size is over the JSON cap (zip bomb)', async () => {
    // 64 KiB of one byte compresses to well under the zip cap.
    const bomb = zipOf({ 'devdigest-result.json': 'a'.repeat(64 * 1024) });
    expect(bomb.byteLength).toBeLessThan(LIMITS.maxZipBytes);
    fetchMock.mockResolvedValue(streamed(bomb));
    await expect(
      new OctokitGitHubClient(TOKEN).downloadArtifactFile(REPO, 1, 'devdigest-result.json', LIMITS),
    ).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });

  it('maps a refused download to a scope error that never contains the token', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 403 }));
    const err = await errorOf(
      new OctokitGitHubClient(TOKEN).downloadArtifactFile(REPO, 1, 'devdigest-result.json', LIMITS),
    );
    expect(err.message).toContain('"Actions: read"');
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('LocalRunnerBundleSource', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dd-runner-bundle-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is null when the bundle was never built (missing file or a directory)', async () => {
    expect(await new LocalRunnerBundleSource(path.join(dir, 'index.js')).read()).toBeNull();
    mkdirSync(path.join(dir, 'dist'));
    expect(await new LocalRunnerBundleSource(path.join(dir, 'dist')).read()).toBeNull();
  });

  it('reads the embedded RUNNER_VERSION, else falls back to the sha prefix', async () => {
    const file = path.join(dir, 'index.js');
    const withMarker = "var x = 1;\nconst RUNNER_VERSION = '2';\n";
    writeFileSync(file, withMarker);
    const b = (await new LocalRunnerBundleSource(file).read())!;
    expect(b.version).toBe('2');
    expect(b.contents).toBe(withMarker);
    expect(b.sha256).toBe(createHash('sha256').update(withMarker).digest('hex'));

    writeFileSync(file, 'console.log(1);\n');
    const noMarker = (await new LocalRunnerBundleSource(file).read())!;
    expect(noMarker.version).toBe(noMarker.sha256.slice(0, 12));
  });

  it('picks up a rebuild (new mtime) without a restart', async () => {
    const file = path.join(dir, 'index.js');
    writeFileSync(file, "const RUNNER_VERSION = '1';\n");
    utimesSync(file, new Date(1_000_000), new Date(1_000_000));
    const src = new LocalRunnerBundleSource(file);
    expect((await src.read())!.version).toBe('1');

    writeFileSync(file, "const RUNNER_VERSION = '3';\n");
    utimesSync(file, new Date(2_000_000), new Date(2_000_000));
    expect((await src.read())!.version).toBe('3');
  });
});
