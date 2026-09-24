/**
 * IntentService (L03, plan Step 9) — hermetic. No Postgres, no network, no key.
 *
 * What is under test is the WIRING the pure helpers cannot prove on their own:
 *   - the confidence band a real collection lands in (indirect-only vs documented),
 *   - that the risk-area verification is actually applied to the model's output,
 *   - the in-flight guard (and that its `finally` releases the key),
 *   - the best-effort contract of `ensureForRun`: it resolves, never rejects,
 *     and prefers a stale row to nothing.
 *
 * Mocking: the LLM is mocked AT THE PORT (`MockLLMProvider` from
 * `src/adapters/mocks.ts`), handed over through the container's `llm(id)` seam —
 * which also pins that the intent path resolves through `openrouter` (the D5
 * default). `container.llm` THROWS for any provider the test did not inject, so
 * a regression that reaches a real provider fails here instead of making a
 * billed call.
 *
 * `IntentRepository` is replaced on the service the same way
 * `repo-intel-facade-degraded.test.ts` replaces `RepoIntelService`'s: this
 * service's constructor takes only the Container, and the DB round-trip is what
 * `intent.it.test.ts` covers against a real Postgres.
 */
import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import type { PullRow, RepoRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import type { RunBus } from '../src/platform/sse.js';
import { IntentService } from '../src/modules/intent/service.js';
import type { IntentWrite, PrIntentRow } from '../src/modules/intent/repository.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { RunLogger } from '../src/platform/run-logger.js';
import { ConflictError } from '../src/platform/errors.js';

const WS = 'ws-1';
const PR_ID = 'pr-1';
const HEAD = 'a1b2c3d4';

/** The model's proposal. `PrIntent` is the schema name the service registers. */
const PROPOSAL = {
  intent: 'Stop a single API client from exhausting the shared Redis pool.',
  in_scope: ['Per-token rate limiting on public endpoints'],
  out_of_scope: ['Authenticated internal endpoints'],
  risk_areas: [{ label: 'Secret handling', evidence_path: 'src/config.ts' }],
};

function pullRow(over: Partial<PullRow> = {}): PullRow {
  return {
    id: PR_ID,
    workspaceId: WS,
    repoId: 'repo-1',
    number: 482,
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/rate-limit-public',
    base: 'main',
    headSha: HEAD,
    lastReviewedSha: null,
    additions: 247,
    deletions: 38,
    filesCount: 2,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...over,
  } as PullRow;
}

function repoRow(): RepoRow {
  return {
    id: 'repo-1',
    workspaceId: WS,
    owner: 'acme',
    name: 'payments-api',
    fullName: 'acme/payments-api',
  } as RepoRow;
}

/** The repository seam: an in-memory `pr_intent` table plus the collectors. */
class FakeIntentRepo {
  rows = new Map<string, PrIntentRow>();
  constructor(
    private pull: PullRow,
    private commits: string[],
    private paths: string[],
  ) {}
  async getPullWithRepo(workspaceId: string, prId: string) {
    return workspaceId === WS && prId === this.pull.id
      ? { pull: this.pull, repo: repoRow() }
      : undefined;
  }
  async getIntent(prId: string) {
    return this.rows.get(prId);
  }
  async upsertIntent(prId: string, values: IntentWrite) {
    const row = { prId, ...values, derivedAt: new Date('2026-09-24T12:00:00Z') } as PrIntentRow;
    this.rows.set(prId, row);
    return row;
  }
  async getCommitMessages() {
    return this.commits;
  }
  async getChangedPaths() {
    return this.paths;
  }
}

/** A provider that stalls inside the model call until the test releases it. */
class GatedLLM extends MockLLMProvider {
  released!: () => void;
  readonly gate = new Promise<void>((resolve) => {
    this.released = resolve;
  });
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await this.gate;
    return super.completeStructured(req);
  }
}

class ThrowingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured(): Promise<never> {
    throw new Error('openrouter 503: upstream unavailable');
  }
  async embed() {
    return [];
  }
}

interface Harness {
  service: IntentService;
  repo: FakeIntentRepo;
  llm: MockLLMProvider;
  providersAsked: string[];
  log: RunLogger;
  logged: string[];
}

function buildService(
  opts: {
    pull?: Partial<PullRow>;
    commits?: string[];
    paths?: string[];
    proposal?: unknown;
    llm?: LLMProvider;
    specFiles?: Record<string, string>;
  } = {},
): Harness {
  const pull = pullRow(opts.pull);
  const repo = new FakeIntentRepo(
    pull,
    opts.commits ?? ['Add rate limiter middleware', 'Cover the limiter with tests'],
    opts.paths ?? ['src/config.ts', 'src/middleware/ratelimit.ts'],
  );
  const llm =
    (opts.llm as MockLLMProvider | undefined) ??
    new MockLLMProvider('openai', {
      structuredBySchema: { PrIntent: opts.proposal ?? PROPOSAL },
    });

  const providersAsked: string[] = [];
  const container = {
    // `resolveFeatureModel` reads the workspace's settings rows; none exist, so
    // the registry default applies — which is the point of the assertion on
    // `providersAsked` below.
    db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
    git: new MockGitClient({ files: opts.specFiles ?? {} }),
    // `getIssue` returns a non-empty body, which is what makes the `issue:<n>`
    // marker count as evidence.
    github: async () => new MockGitHubClient(),
    llm: async (id: string) => {
      providersAsked.push(id);
      if (id !== 'openrouter') {
        throw new Error(`test injected no "${id}" provider — a real one would be built here`);
      }
      return llm;
    },
  } as unknown as Container;

  const service = new IntentService(container);
  (service as unknown as { repo: FakeIntentRepo }).repo = repo;

  const logged: string[] = [];
  const bus = {
    publish: (_runId: string, kind: string, msg: string) => {
      logged.push(`${kind}: ${msg}`);
    },
  } as unknown as RunBus;
  return { service, repo, llm, providersAsked, log: new RunLogger(bus, ['run-1']), logged };
}

describe('IntentService.derive — confidence comes from the evidence that was there (D3)', () => {
  it('a body-less PR lands in the low band, on indirect signals only', async () => {
    const h = buildService({ pull: { body: null } });
    const record = await h.service.derive(WS, PR_ID);

    // commits + branch + paths and nothing else: no spec, no issue, no body.
    expect(record.sources).toEqual(['commits', 'branch', 'paths']);
    expect(record.confidence).toBe(0.2);
    // < 0.40 is the documented low/medium boundary.
    expect(record.confidence).toBeLessThan(0.4);
    expect(record.is_stale).toBe(false);
    expect(record.intent).toBe(PROPOSAL.intent);

    // The derivation resolved through OpenRouter (the shipped default). If this
    // ever asks for another provider, an integration test injecting only one
    // mock would silently make a real, billed call.
    expect(h.providersAsked).toEqual(['openrouter']);
    const call = h.llm.calls.find((c) => c.method === 'completeStructured');
    expect((call?.req as { schemaName: string }).schemaName).toBe('PrIntent');
  });

  it('a PR with a linked issue AND a referenced spec lands in the high band', async () => {
    const body = [
      '## Summary',
      'Closes #471. Built from [the plan](docs/plans/lab03.plan.md).',
      'Adds per-token rate limiting to the public API endpoints so one client',
      'cannot exhaust the shared Redis connection pool during a traffic spike.',
    ].join('\n');
    const h = buildService({
      pull: { body },
      specFiles: { 'docs/plans/lab03.plan.md': '# Plan\nRate-limit the public API.' },
    });

    const record = await h.service.derive(WS, PR_ID);

    expect(record.sources).toEqual([
      'spec:docs/plans/lab03.plan.md',
      'issue:471',
      'body',
      'commits',
      'branch',
      'paths',
    ]);
    // 0.30 + 0.25 + 0.25 + 0.10 + 0.05 + 0.05, clamped below certainty.
    expect(record.confidence).toBe(0.95);
    expect(record.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('a spec the clone cannot serve lowers confidence instead of failing derivation', async () => {
    // MockGitClient returns '' for an unknown path; an empty read is not a spec.
    const h = buildService({
      pull: { body: 'Built from [the plan](docs/plans/missing.plan.md).' },
      specFiles: {},
    });
    const record = await h.service.derive(WS, PR_ID);
    expect(record.sources).not.toContain('spec:docs/plans/missing.plan.md');
    expect(record.confidence).toBe(0.2);
  });
});

describe('IntentService.derive — the model proposes, the code verifies (D4)', () => {
  it('drops a risk area citing a path this PR does not change, and says so in the log', async () => {
    const h = buildService({
      paths: ['src/config.ts'],
      proposal: {
        ...PROPOSAL,
        risk_areas: [
          { label: 'Secret handling', evidence_path: 'src/config.ts' },
          { label: 'Invented worry', evidence_path: 'src/never-touched.ts' },
          { label: 'Uncited worry', evidence_path: null },
        ],
      },
    });

    const record = await h.service.derive(WS, PR_ID, h.log);

    expect(record.risk_areas).toEqual([
      { label: 'Secret handling', evidence_path: 'src/config.ts' },
    ]);
    expect(h.logged.join('\n')).toContain('dropped 2 risk area(s)');
  });

  it('refuses to write a row for a PR with no changed files (D1’s floor)', async () => {
    const h = buildService({ paths: [] });
    await expect(h.service.derive(WS, PR_ID)).rejects.toThrow(/no changed files/i);
    expect(h.repo.rows.size).toBe(0);
    // No paid model call either.
    expect(h.llm.calls).toEqual([]);
  });
});

describe('IntentService.derive — the in-flight guard', () => {
  it('rejects a second concurrent derive for the same PR with ConflictError', async () => {
    const gated = new GatedLLM('openai', { structuredBySchema: { PrIntent: PROPOSAL } });
    const h = buildService({ llm: gated });

    const first = h.service.derive(WS, PR_ID);
    // The key is registered synchronously, before the first await, so the second
    // caller is rejected while the first is still inside the model call.
    await expect(h.service.derive(WS, PR_ID)).rejects.toThrow(ConflictError);

    gated.released();
    await expect(first).resolves.toMatchObject({ pr_id: PR_ID });

    // …and the guard released: a third derive after the first settled succeeds.
    // A `finally` that never ran would wedge this PR forever.
    await expect(h.service.derive(WS, PR_ID)).resolves.toMatchObject({ pr_id: PR_ID });
  });

  it('releases the guard when derivation FAILS, not only when it succeeds', async () => {
    const h = buildService({ paths: [] });
    await expect(h.service.derive(WS, PR_ID)).rejects.toThrow();
    // Same PR, now with files: it must not be stuck behind a stale in-flight key.
    const h2 = buildService();
    await expect(h2.service.derive(WS, PR_ID)).resolves.toMatchObject({ pr_id: PR_ID });
  });
});

describe('IntentService.ensureForRun — best-effort, never fails a review', () => {
  it('resolves undefined (not a rejection) when the model call throws and nothing is cached', async () => {
    const h = buildService({ llm: new ThrowingLLM() });

    await expect(
      h.service.ensureForRun(WS, pullRow(), repoRow(), h.log),
    ).resolves.toBeUndefined();

    const log = h.logged.join('\n');
    expect(log).toContain('intent: derivation failed');
    expect(log).toContain('upstream unavailable');
    // Degrades to an `info` line — never an `error` event, which is the diff
    // step's failure channel.
    expect(h.logged.some((l) => l.startsWith('error:'))).toBe(false);
  });

  it('prefers a STALE cached row over undefined when re-derivation fails', async () => {
    const h = buildService({ llm: new ThrowingLLM() });
    h.repo.rows.set(PR_ID, {
      prId: PR_ID,
      intent: 'Previously derived, one commit ago.',
      inScope: ['Old scope'],
      outOfScope: [],
      confidence: 0.55,
      riskAreas: [],
      sources: ['body', 'commits', 'paths'],
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      headSha: 'olddead',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.0003,
      derivedAt: new Date('2026-09-23T10:00:00Z'),
    } as PrIntentRow);

    const record = await h.service.ensureForRun(WS, pullRow(), repoRow(), h.log);

    expect(record?.intent).toBe('Previously derived, one commit ago.');
    // Flagged stale, because it was derived against a different head.
    expect(record?.is_stale).toBe(true);
    expect(record?.head_sha).toBe('olddead');
    expect(h.logged.join('\n')).toContain('falling back to the previous (stale) derivation');
  });

  it('reuses a row derived against the SAME head with no model call at all', async () => {
    const h = buildService();
    const fresh = await h.service.derive(WS, PR_ID);
    const callsAfterDerive = h.llm.calls.length;

    const reused = await h.service.ensureForRun(WS, pullRow(), repoRow(), h.log);

    expect(reused).toEqual(fresh);
    expect(h.llm.calls.length).toBe(callsAfterDerive);
    expect(h.logged.join('\n')).toContain('reusing cached derivation');
  });

  it('re-derives when the head moved, and the new row is no longer stale', async () => {
    const h = buildService();
    h.repo.rows.set(PR_ID, {
      prId: PR_ID,
      intent: 'Derived against an older commit.',
      inScope: [],
      outOfScope: [],
      confidence: 0.2,
      riskAreas: [],
      sources: ['paths'],
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      headSha: 'olddead',
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      derivedAt: new Date('2026-09-23T10:00:00Z'),
    } as PrIntentRow);

    const record = await h.service.ensureForRun(WS, pullRow(), repoRow(), h.log);

    expect(record?.intent).toBe(PROPOSAL.intent);
    expect(record?.head_sha).toBe(HEAD);
    expect(record?.is_stale).toBe(false);
  });
});

describe('IntentService.get', () => {
  it('returns null before anything is derived, and the record afterwards', async () => {
    const h = buildService();
    await expect(h.service.get(WS, PR_ID)).resolves.toBeNull();
    await h.service.derive(WS, PR_ID);
    await expect(h.service.get(WS, PR_ID)).resolves.toMatchObject({
      pr_id: PR_ID,
      is_stale: false,
    });
  });

  it('404s for a PR outside the workspace', async () => {
    const h = buildService();
    await expect(h.service.get('other-workspace', PR_ID)).rejects.toThrow(/not found/i);
  });
});
