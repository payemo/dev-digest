import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import type { EvalExpectedFinding, EvalLocation, EvalPrMeta } from '@devdigest/shared';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { fileDiffText, isCitable } from '../modules/eval/helpers.js';
import { EVAL_FILE_NOTE } from '../modules/eval/constants.js';

/**
 * L06 demo data for the eval pipeline. Two independent, idempotent parts:
 *
 *  (a) Demo PR #491 with REAL stored patches and a Security Reviewer review
 *      whose findings are one accepted, one dismissed and one undecided — so
 *      "Turn into eval case" can be shown live. (PR #482's stored files carry no
 *      patches, so nothing on it can be frozen into a case.)
 *  (b) A self-contained Security Reviewer eval set (≥ 8 cases, both kinds),
 *      each with its own small frozen diff + PR meta.
 *
 * Every expectation and forbidden location is checked against its own diff with
 * the real grounding gate at seed time; a fixture that is not citable throws.
 * All keys below are obviously fake demo strings, never real credentials.
 */

const SECURITY_REVIEWER = 'Security Reviewer';
const DEMO_PR_NUMBER = 491;

const lines = (...l: string[]) => l.join('\n');

// ---- per-file patches (GitHub `patch` format: hunks only) ----------------

const CONFIG_PATCH = lines(
  '@@ -10,3 +10,4 @@ export const config = {',
  '   port: 3000,',
  "   host: '0.0.0.0',",
  "+  stripeKey: 'sk_live_DEMO_NOT_A_REAL_KEY_0000',",
  '   redisUrl: process.env.REDIS_URL,',
);

const WEBHOOKS_PATCH = lines(
  '@@ -58,4 +58,10 @@ export async function forwardWebhook(req: Request) {',
  '   const account = await loadAccount(req.params.id);',
  '   const token = account.apiToken;',
  '+  const target = req.body.callback_url;',
  '+  await fetch(target, {',
  "+    method: 'POST',",
  "+    headers: { authorization: 'Bearer ' + token },",
  '+    body: JSON.stringify(req.body.event),',
  '+  });',
  '   return { ok: true };',
  ' }',
);

const USERS_IMPORT_PATCH = lines(
  '@@ -1,4 +1,5 @@',
  " import { db } from '../db';",
  "+import { pick } from 'lodash';",
  " import { users } from '../schema';",
  ' ',
  ' export async function listUsers() {',
);

const RATELIMIT_PATCH = lines(
  '@@ -48,5 +48,8 @@ export function rateLimit(opts: Options) {',
  '     const bucket = buckets.get(key);',
  '     if (!bucket.take()) {',
  '+      res.statusCode = 429;',
  "+      res.end('Too Many Requests');",
  '+      return;',
  '     }',
  '     next();',
);

const USERS_N_PLUS_1_PATCH = lines(
  '@@ -20,3 +20,6 @@ export async function listUsers() {',
  '   const rows = await db.select().from(users);',
  '-  return rows;',
  '+  for (const row of rows) {',
  '+    row.orders = await db.select().from(orders).where(eq(orders.userId, row.id));',
  '+  }',
  '+  return rows;',
  ' }',
);

const TRIFECTA_PATCH = lines(
  '@@ -0,0 +1,6 @@',
  '+export async function onEvent(req: Request) {',
  "+  const secret = await vault.read('payments/api-token');",
  '+  const url = req.body.notify_url;',
  "+  await fetch(url, { method: 'POST', body: secret });",
  '+  return { ok: true };',
  '+}',
);

const RAW_BODY_PATCH = lines(
  '@@ -5,3 +5,4 @@',
  ' const app = Fastify();',
  ' app.register(cors);',
  "+app.addContentTypeParser('application/json', { parseAs: 'buffer' }, rawJson);",
  ' app.register(routes);',
);

const TEST_FIXTURE_PATCH = lines(
  '@@ -0,0 +1,3 @@',
  "+// Stripe's documented test-mode key format, used only by unit tests.",
  "+export const STRIPE_TEST_KEY = 'sk_test_DEMO_FIXTURE_0000';",
  "+export const STRIPE_TEST_CUSTOMER = 'cus_test_0000';",
);

// ---- (a) demo PR #491 ------------------------------------------------------

const PR_491 = {
  title: 'Add Stripe checkout and webhook forwarder',
  author: 'deepak.r',
  branch: 'feat/stripe-checkout',
  body: 'Wires Stripe checkout into the payments API and forwards provider webhooks to a merchant-configured callback.',
};

const PR_491_FILES = [
  { path: 'src/config.ts', additions: 1, deletions: 0, patch: CONFIG_PATCH },
  { path: 'src/api/public/webhooks.ts', additions: 6, deletions: 0, patch: WEBHOOKS_PATCH },
  { path: 'src/api/users.ts', additions: 1, deletions: 0, patch: USERS_IMPORT_PATCH },
];

// ---- (b) the Security Reviewer eval set ---------------------------------

interface DemoCase {
  name: string;
  kind: 'must_find' | 'must_not_flag';
  file: string;
  patch: string;
  meta: EvalPrMeta;
  expected: EvalExpectedFinding[];
  forbidden: EvalLocation | null;
  notes: string;
}

const meta = (number: number, title: string, description: string): EvalPrMeta => ({
  number,
  title,
  description,
  author: 'demo',
});

const DEMO_CASES: DemoCase[] = [
  {
    name: 'stripe-key-leak',
    kind: 'must_find',
    file: 'src/config.ts',
    patch: CONFIG_PATCH,
    meta: meta(491, 'Add Stripe checkout', 'Adds the Stripe key to the config.'),
    expected: [
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        file: 'src/config.ts',
        start_line: 12,
      },
    ],
    forbidden: null,
    notes: 'A live-format secret key committed to config must always be flagged.',
  },
  {
    name: 'ssrf-webhook',
    kind: 'must_find',
    file: 'src/api/public/webhooks.ts',
    patch: WEBHOOKS_PATCH,
    meta: meta(491, 'Forward provider webhooks', 'Forwards webhook events to the merchant callback.'),
    expected: [
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'SSRF: request sent to an attacker-controlled callback_url',
        file: 'src/api/public/webhooks.ts',
        start_line: 60,
        end_line: 61,
      },
    ],
    forbidden: null,
    notes: 'Outbound request to a URL taken straight from the request body.',
  },
  {
    name: 'missing-retry-after',
    kind: 'must_find',
    file: 'src/middleware/ratelimit.ts',
    patch: RATELIMIT_PATCH,
    meta: meta(482, 'Add rate limiting to public API endpoints', 'Return 429 with Retry-After.'),
    expected: [
      {
        severity: 'WARNING',
        category: 'bug',
        title: '429 returned without a Retry-After header',
        file: 'src/middleware/ratelimit.ts',
        start_line: 50,
        end_line: 51,
      },
    ],
    forbidden: null,
    notes: 'The PR description promises Retry-After; the 429 branch omits it.',
  },
  {
    name: 'n-plus-1-users-query',
    kind: 'must_find',
    file: 'src/api/users.ts',
    patch: USERS_N_PLUS_1_PATCH,
    meta: meta(482, 'Include orders in the user list', 'Adds each user’s orders to the list response.'),
    expected: [
      {
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        file: 'src/api/users.ts',
        start_line: 21,
        end_line: 23,
      },
    ],
    forbidden: null,
    notes: 'One query per user inside a loop.',
  },
  {
    name: 'lethal-trifecta-callback',
    kind: 'must_find',
    file: 'src/api/public/hooks.ts',
    patch: TRIFECTA_PATCH,
    meta: meta(493, 'Notify merchants on payment events', 'Posts payment events to the merchant notify_url.'),
    expected: [
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'Private token sent to an untrusted URL (lethal trifecta)',
        file: 'src/api/public/hooks.ts',
        start_line: 2,
        end_line: 4,
      },
    ],
    forbidden: null,
    notes: 'Private data + untrusted input + exfil path in one handler.',
  },
  {
    name: 'no-unused-import-warning',
    kind: 'must_not_flag',
    file: 'src/api/users.ts',
    patch: USERS_IMPORT_PATCH,
    meta: meta(491, 'Add Stripe checkout and webhook forwarder', 'Prepares the user module for checkout.'),
    expected: [],
    forbidden: { file: 'src/api/users.ts', start_line: 2, end_line: 2 },
    notes: 'An unused import is lint noise, not a security finding.',
  },
  {
    name: 'no-raw-body-parser-flag',
    kind: 'must_not_flag',
    file: 'src/server.ts',
    patch: RAW_BODY_PATCH,
    meta: meta(494, 'Keep raw JSON body for webhook signatures', 'Stripe signature checks need the raw body.'),
    expected: [],
    forbidden: { file: 'src/server.ts', start_line: 7, end_line: 7 },
    notes: 'Parsing JSON as a buffer for signature verification is intended.',
  },
  {
    name: 'no-test-fixture-secret',
    kind: 'must_not_flag',
    file: 'test/fixtures/stripe.ts',
    patch: TEST_FIXTURE_PATCH,
    meta: meta(495, 'Add Stripe test fixtures', 'Test-mode identifiers for unit tests.'),
    expected: [],
    forbidden: { file: 'test/fixtures/stripe.ts', start_line: 2, end_line: 2 },
    notes: 'A documented test-mode placeholder is not a leaked credential.',
  },
];

/** Throw unless `loc` is citable in the single-file diff of `file`/`patch`. */
function assertCitable(caseName: string, file: string, patch: string, loc: EvalLocation): void {
  if (!isCitable(parseUnifiedDiff(fileDiffText(file, patch)), loc)) {
    throw new Error(
      `seed-eval: fixture "${caseName}" is not citable at ${loc.file}:${loc.start_line}-${loc.end_line}`,
    );
  }
}

async function seedDemoPr491(
  db: Db,
  workspaceId: string,
  repoId: string,
  securityReviewerId: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: t.pullRequests.id })
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, DEMO_PR_NUMBER)));
  if (existing) return;

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: DEMO_PR_NUMBER,
      title: PR_491.title,
      author: PR_491.author,
      branch: PR_491.branch,
      base: 'main',
      headSha: 'demo491sha',
      additions: PR_491_FILES.reduce((n, f) => n + f.additions, 0),
      deletions: 0,
      filesCount: PR_491_FILES.length,
      status: 'needs_review',
      body: PR_491.body,
    })
    .returning();
  await db.insert(t.prFiles).values(PR_491_FILES.map((f) => ({ prId: pr!.id, ...f })));

  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId: pr!.id,
      agentId: securityReviewerId,
      kind: 'review',
      verdict: 'request_changes',
      summary: 'A live-format Stripe key is committed and the webhook forwarder posts to an attacker-controlled URL.',
      score: 35,
      model: 'seed',
    })
    .returning();

  const now = new Date();
  const findings = [
    {
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key in commit',
      rationale: 'Line 12 adds a literal string starting with sk_live_, a Stripe secret key format.',
      suggestion: 'Load the key from the environment and rotate it.',
      confidence: 0.97,
      acceptedAt: now,
    },
    {
      file: 'src/api/users.ts',
      startLine: 2,
      endLine: 2,
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Unused lodash import',
      rationale: '`pick` is imported but never used.',
      suggestion: 'Remove the import.',
      confidence: 0.6,
      dismissedAt: now,
    },
    {
      file: 'src/api/public/webhooks.ts',
      startLine: 60,
      endLine: 61,
      severity: 'CRITICAL',
      category: 'security',
      title: 'SSRF: webhook forwarded to an attacker-controlled callback_url',
      rationale: 'The handler posts the account token to a URL taken from the request body.',
      suggestion: 'Validate callback_url against a per-merchant allowlist.',
      confidence: 0.84,
    },
  ];
  for (const f of findings) {
    assertCitable(f.title, f.file, PR_491_FILES.find((p) => p.path === f.file)!.patch, {
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
    });
  }
  await db.insert(t.findings).values(findings.map((f) => ({ ...f, reviewId: review!.id })));
}

async function seedSecurityEvalSet(
  db: Db,
  workspaceId: string,
  securityReviewerId: string,
): Promise<void> {
  const existing = await db
    .select({ name: t.evalCases.name })
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, securityReviewerId),
      ),
    );
  const taken = new Set(existing.map((r) => r.name));

  for (const c of DEMO_CASES) {
    for (const e of c.expected) {
      assertCitable(c.name, c.file, c.patch, {
        file: e.file,
        start_line: e.start_line,
        end_line: e.end_line ?? e.start_line,
      });
    }
    if (c.forbidden) assertCitable(c.name, c.file, c.patch, c.forbidden);
    if (taken.has(c.name)) continue;

    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: securityReviewerId,
      name: c.name,
      kind: c.kind,
      inputDiff: fileDiffText(c.file, c.patch),
      inputFiles: [{ path: c.file, note: EVAL_FILE_NOTE }],
      inputMeta: c.meta,
      expectedOutput: c.expected,
      forbiddenLocation: c.forbidden,
      notes: c.notes,
    });
  }
}

/** Seed the eval demo (idempotent). No-op if the Security Reviewer is missing. */
export async function seedEvalDemo(
  db: Db,
  workspaceId: string,
  repoId: string,
  agentIdByName: Map<string, string>,
): Promise<void> {
  const securityReviewerId = agentIdByName.get(SECURITY_REVIEWER);
  if (!securityReviewerId) return;
  await seedDemoPr491(db, workspaceId, repoId, securityReviewerId);
  await seedSecurityEvalSet(db, workspaceId, securityReviewerId);
}
