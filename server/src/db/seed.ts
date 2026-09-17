import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  const agentIdByName = new Map<string, string>();
  for (const a of seedAgents) {
    let [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) [existing] = await db.insert(t.agents).values(a).returning();
    agentIdByName.set(a.name, existing!.id);
  }

  // ---- richer demo timeline for PR #482 (idempotent: only if it has no
  // agent_runs yet — NOT gated on pr482IsNew, since most dev DBs already
  // have PR #482 seeded from before this timeline enrichment was added) ----
  const [existingRun] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.prId, pr!.id))
    .limit(1);
  if (!existingRun) {
    await seedPr482Timeline(db, workspaceId, pr!.id, agentIdByName);
  }

  // ---- a couple of extra demo PRs, for list variety ----
  await seedExtraDemoPrs(db, workspaceId, repoId, agentIdByName);

  return { workspaceId, userId };
}

/**
 * Extra agent_runs + linked reviews/findings + commits for PR #482, so its
 * Timeline and Review runs sections show more than one legacy review. Only
 * called when the PR was just created (see `pr482IsNew` above).
 */
async function seedPr482Timeline(
  db: Db,
  workspaceId: string,
  prId: string,
  agentIdByName: Map<string, string>,
): Promise<void> {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

  await db.insert(t.prCommits).values([
    {
      prId,
      sha: '2ba3303f1e8a',
      message: 'Initial commit: public API namespace',
      author: 'deepak.r',
      committedAt: hoursAgo(6),
    },
    {
      prId,
      sha: 'e694ac83b2c1',
      message: 'fix(ci): pin lockfile for the rate-limit branch',
      author: 'marisa.koch',
      committedAt: hoursAgo(2),
    },
  ]);

  // Security Reviewer — done, 2 blockers.
  const [securityRun] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId,
      agentId: agentIdByName.get('Security Reviewer') ?? null,
      prId,
      ranAt: hoursAgo(3),
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      durationMs: 24_000,
      tokensIn: 6_209,
      tokensOut: 2_248,
      costUsd: 0.0012,
      status: 'done',
      source: 'local',
      findingsCount: 3,
      grounding: 'diff+repo-intel',
      score: 38,
      blockers: 2,
    })
    .returning();
  const [securityReview] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: agentIdByName.get('Security Reviewer') ?? null,
      runId: securityRun!.id,
      kind: 'review',
      verdict: 'request_changes',
      summary:
        'Two critical exposures block merge: a live Stripe key in git history and an untrusted-input path reaching an exfil sink.',
      score: 38,
      model: DEFAULT_MODEL,
      createdAt: hoursAgo(3),
    })
    .returning();
  await db.insert(t.findings).values([
    {
      reviewId: securityReview!.id,
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key in commit',
      rationale:
        'Line 12 contains a literal string starting with sk_live_, which appears to be a Stripe secret key. Committing this exposes it to anyone with read access to the repo.',
      suggestion: 'Move the key to an environment variable and rotate it immediately.',
      confidence: 0.98,
    },
    {
      reviewId: securityReview!.id,
      file: 'src/api/public/webhooks.ts',
      startLine: 61,
      endLine: 74,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta: untrusted input reaches exfil path',
      rationale:
        'The webhook handler reads attacker-controllable req.body.callback_url (untrusted input), loads the account API token from the DB (private data), and issues an outbound request to that URL (exfil path) — all three trifecta components present.',
      suggestion: 'Validate callback_url against an allowlist before the outbound request.',
      confidence: 0.79,
      kind: 'lethal_trifecta',
    },
    {
      reviewId: securityReview!.id,
      file: 'src/middleware/ratelimit.ts',
      startLine: 52,
      endLine: 52,
      severity: 'WARNING',
      category: 'bug',
      title: 'Retry-After header omitted on 429',
      rationale:
        'The PR intent explicitly lists "Return 429 with Retry-After header" as in-scope, but the 429 branch sets only the status code. Clients can\'t back off correctly without it.',
      suggestion: 'Set res.setHeader("Retry-After", retryAfterSeconds) alongside the 429 status.',
      confidence: 0.81,
    },
  ]);

  // Performance Reviewer — done, no blockers.
  const [perfRun] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId,
      agentId: agentIdByName.get('Performance Reviewer') ?? null,
      prId,
      ranAt: hoursAgo(1.5),
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      durationMs: 11_000,
      tokensIn: 3_112,
      tokensOut: 980,
      costUsd: 0.0008,
      status: 'done',
      source: 'local',
      findingsCount: 2,
      grounding: 'diff+repo-intel',
      score: 64,
      blockers: 0,
    })
    .returning();
  const [perfReview] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: agentIdByName.get('Performance Reviewer') ?? null,
      runId: perfRun!.id,
      kind: 'review',
      verdict: 'comment',
      summary: 'No blockers, but two perf smells on the new limiter worth a follow-up before merge.',
      score: 64,
      model: DEFAULT_MODEL,
      createdAt: hoursAgo(1.5),
    })
    .returning();
  await db.insert(t.findings).values([
    {
      reviewId: perfReview!.id,
      file: 'src/middleware/ratelimit.ts',
      startLine: 30,
      endLine: 40,
      severity: 'WARNING',
      category: 'perf',
      title: 'Missing index on rate_limit_buckets(user_id)',
      rationale: 'Every request does a lookup by user_id; under the new limiter this becomes a hot-path table scan.',
      suggestion: 'Add an index on rate_limit_buckets(user_id).',
      confidence: 0.83,
    },
    {
      reviewId: perfReview!.id,
      file: 'src/middleware/ratelimit.ts',
      startLine: 18,
      endLine: 25,
      severity: 'SUGGESTION',
      category: 'perf',
      title: 'Unbounded in-memory bucket map grows per unique client',
      rationale: 'The token-bucket map is never evicted, so it grows unbounded with distinct client IPs/keys.',
      suggestion: 'Evict idle buckets on a TTL, or bound the map size with an LRU.',
      confidence: 0.7,
    },
  ]);

  // General Reviewer — failed (provider rate limit), no review produced.
  await db.insert(t.agentRuns).values({
    workspaceId,
    agentId: agentIdByName.get('General Reviewer') ?? null,
    prId,
    ranAt: hoursAgo(0.5),
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    durationMs: 800,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: null,
    status: 'failed',
    error: '429 You exceeded your current quota, please check your plan and billing details.',
    source: 'local',
    findingsCount: 0,
    grounding: 'diff+repo-intel',
    score: null,
    blockers: 0,
  });
}

/** A couple of lightweight extra PRs so the Pull Requests list has variety
 *  beyond #482. Each is idempotent, guarded by its own PR-number check. */
async function seedExtraDemoPrs(
  db: Db,
  workspaceId: string,
  repoId: string,
  agentIdByName: Map<string, string>,
): Promise<void> {
  const generalReviewerId = agentIdByName.get('General Reviewer') ?? null;
  const extraPrs: Array<{
    number: number;
    title: string;
    author: string;
    branch: string;
    additions: number;
    deletions: number;
    filesCount: number;
    status: string;
    verdict: 'approve' | 'comment';
    score: number;
    summary: string;
    findings: Array<Pick<typeof t.findings.$inferInsert, 'file' | 'startLine' | 'endLine' | 'severity' | 'category' | 'title' | 'rationale' | 'suggestion' | 'confidence'>>;
  }> = [
    {
      number: 477,
      title: 'Fix flaky checkout integration test',
      author: 'tomek.w',
      branch: 'fix/flaky-checkout-test',
      additions: 20,
      deletions: 8,
      filesCount: 2,
      status: 'reviewed',
      verdict: 'approve',
      score: 92,
      summary: 'Clean fix — the test was racing on an unawaited promise.',
      findings: [
        {
          file: 'tests/checkout.int.test.ts',
          startLine: 34,
          endLine: 34,
          severity: 'SUGGESTION',
          category: 'test',
          title: 'Prefer an explicit wait over the retry loop',
          rationale: 'The added retry loop works but a waitFor() on the specific condition would be clearer.',
          suggestion: 'Replace the manual retry with waitFor(() => expect(...)).',
          confidence: 0.72,
        },
      ],
    },
    {
      number: 468,
      title: 'Add idempotency keys to charge endpoint',
      author: 'marisa.koch',
      branch: 'feat/idempotency-charge',
      additions: 180,
      deletions: 40,
      filesCount: 6,
      status: 'reviewed',
      verdict: 'comment',
      score: 81,
      summary: 'Solid approach; one race condition and one naming nit.',
      findings: [
        {
          file: 'src/api/charges.ts',
          startLine: 88,
          endLine: 102,
          severity: 'WARNING',
          category: 'bug',
          title: 'Idempotency key check-then-insert is not atomic',
          rationale:
            'Two concurrent requests with the same key can both pass the existence check before either inserts, double-charging the customer.',
          suggestion: 'Use a unique constraint on idempotency_key and catch the conflict, instead of check-then-insert.',
          confidence: 0.88,
        },
        {
          file: 'src/api/charges.ts',
          startLine: 12,
          endLine: 12,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'idempotencyKey vs idempotency_key naming mismatch',
          rationale: 'The DB column is snake_case but the request field is camelCase with no shared mapper.',
          suggestion: 'Route both through the existing zod contract instead of hand-mapping.',
          confidence: 0.6,
        },
      ],
    },
  ];

  for (const spec of extraPrs) {
    const [existing] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, spec.number)));
    if (existing) continue;

    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: spec.number,
        title: spec.title,
        author: spec.author,
        branch: spec.branch,
        base: 'main',
        headSha: `demo${spec.number}sha`,
        additions: spec.additions,
        deletions: spec.deletions,
        filesCount: spec.filesCount,
        status: spec.status,
        body: spec.title,
      })
      .returning();

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        agentId: generalReviewerId,
        kind: 'review',
        verdict: spec.verdict,
        summary: spec.summary,
        score: spec.score,
        model: DEFAULT_MODEL,
      })
      .returning();

    await db.insert(t.findings).values(
      spec.findings.map((f) => ({ ...f, reviewId: review!.id })),
    );
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
