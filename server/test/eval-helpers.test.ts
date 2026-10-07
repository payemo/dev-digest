import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { EvalCaseInput, type EvalAgentRun, type EvalSkillSnapshotEntry } from '@devdigest/shared';
import {
  buildSeedDraft,
  buildSkillSnapshot,
  compareRuns,
  isForeignOrigin,
  metricDeltas,
  precisionDip,
  sameSkillState,
  skillDiff,
  slugifyCaseName,
  toAgentRunDto,
  trendPoints,
  uniqueCaseName,
} from '../src/modules/eval/helpers.js';
import type { EvalAgentRunRow } from '../src/db/rows.js';

/**
 * Pure eval helpers (spec 04): case naming (FR-5), seeding a frozen case from a
 * decided finding (FR-2 – FR-6, AC-19), skill snapshots (R3), compare (FR-22),
 * the precision-dip banner rule (FR-21 / D6), deltas and trend order.
 */

// ---------------------------------------------------------------------------
// Request origin (CSRF guard)
// ---------------------------------------------------------------------------

describe('isForeignOrigin', () => {
  const studio = 'http://localhost:3000';
  it('only an Origin header naming another site is foreign', () => {
    expect(isForeignOrigin('https://evil.example', studio)).toBe(true);
    expect(isForeignOrigin('http://localhost:3001', studio)).toBe(true);
    expect(isForeignOrigin(studio, studio)).toBe(false);
    expect(isForeignOrigin(undefined, studio)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Names (FR-5)
// ---------------------------------------------------------------------------

describe('slugifyCaseName (FR-5)', () => {
  it('AC-14: a positive case gets the must-find- prefix and a lower-case hyphen slug', () => {
    expect(slugifyCaseName('must_find', 'Hardcoded Stripe secret key in commit', new Set())).toBe(
      'must-find-hardcoded-stripe-secret-key-in-commit',
    );
  });

  it('a negative case gets the no- prefix; punctuation runs collapse to one hyphen', () => {
    expect(slugifyCaseName('must_not_flag', 'Unused lodash import', new Set())).toBe(
      'no-unused-lodash-import',
    );
    expect(slugifyCaseName('must_find', '  SSRF: webhook -- forwarded!! ', new Set())).toBe(
      'must-find-ssrf-webhook-forwarded',
    );
  });

  it('AC-15: a long title is capped at 80 chars without leaving a trailing hyphen', () => {
    // 'must-find-' (10) + 69 a's = 79; the 80th char would be the hyphen before "tail".
    const title = `${'a'.repeat(69)} tail words that overflow the cap`;
    const name = slugifyCaseName('must_find', title, new Set());
    expect(name).toBe(`must-find-${'a'.repeat(69)}`);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('-')).toBe(false);

    const veryLong = slugifyCaseName('must_not_flag', 'word '.repeat(60), new Set());
    expect(veryLong.length).toBeLessThanOrEqual(80);
    expect(veryLong.startsWith('no-word-word')).toBe(true);
    expect(veryLong.endsWith('-')).toBe(false);
  });

  it('AC-16: a taken name gets -2, -3, … and the suffixed name still fits in 80 chars', () => {
    const taken = new Set(['must-find-sql-injection']);
    expect(slugifyCaseName('must_find', 'SQL injection', taken)).toBe('must-find-sql-injection-2');
    taken.add('must-find-sql-injection-2');
    expect(slugifyCaseName('must_find', 'SQL injection', taken)).toBe('must-find-sql-injection-3');

    const full = `must-find-${'b'.repeat(70)}`; // exactly 80
    expect(uniqueCaseName(full, new Set([full]))).toBe(`must-find-${'b'.repeat(68)}-2`);

    // Re-truncating the base must not produce a double hyphen before the suffix.
    const hyphenAt79 = `must-find-${'b'.repeat(67)}-cc`; // 80; cut to 78 ends in '-'
    const next = uniqueCaseName(hyphenAt79, new Set([hyphenAt79]));
    expect(next).toBe(`must-find-${'b'.repeat(67)}-2`);
    expect(next).not.toContain('--');
  });
});

// ---------------------------------------------------------------------------
// Seeding (FR-2 – FR-6)
// ---------------------------------------------------------------------------

const CONFIG_PATCH = [
  '@@ -10,3 +10,4 @@ export const config = {',
  '   port: 3000,',
  "   host: '0.0.0.0',",
  "+  stripeKey: 'sk_live_DEMO_NOT_A_REAL_KEY_0000',",
  '   redisUrl: process.env.REDIS_URL,',
].join('\n');

const WEBHOOKS_PATCH = [
  '@@ -58,4 +58,6 @@ export async function forwardWebhook(req: Request) {',
  '   const account = await loadAccount(req.params.id);',
  '   const token = account.apiToken;',
  '+  const target = req.body.callback_url;',
  '+  await fetch(target, { body: token });',
  '   return { ok: true };',
  ' }',
].join('\n');

const pull = {
  number: 491,
  title: 'Add Stripe checkout',
  body: 'Wires Stripe checkout.',
  author: 'deepak.r',
};

const decided = new Date('2026-09-01T00:00:00Z');

function stripeFinding(overrides: Record<string, unknown> = {}) {
  return {
    acceptedAt: decided as Date | null,
    dismissedAt: null as Date | null,
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key in commit',
    ...overrides,
  };
}

describe('buildSeedDraft (FR-3, FR-4, FR-6)', () => {
  it('AC-8/AC-9: an accepted finding seeds a must_find case with its frozen input and one expectation', () => {
    const res = buildSeedDraft({ finding: stripeFinding(), pull, patch: CONFIG_PATCH, taken: new Set() });
    if ('refused' in res) throw new Error(`unexpected refusal: ${res.refused}`);
    expect(res.decision).toBe('accepted');
    const d = res.draft;
    expect(d.kind).toBe('must_find');
    expect(d.name).toBe('must-find-hardcoded-stripe-secret-key-in-commit');
    // Single-line finding → no end_line key at all.
    expect(d.expected_output).toEqual([
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        file: 'src/config.ts',
        start_line: 12,
      },
    ]);
    expect(d.forbidden_location ?? null).toBeNull();
    // Frozen input (D3): the single-file diff text, a reference-only file, the PR meta.
    expect(d.input_diff).toBe(
      `diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n${CONFIG_PATCH}`,
    );
    expect(d.input_files).toEqual([
      { path: 'src/config.ts', note: 'reference only — not sent to the agent' },
    ]);
    expect(d.input_meta).toEqual({
      number: 491,
      title: 'Add Stripe checkout',
      description: 'Wires Stripe checkout.',
      author: 'deepak.r',
    });
    // The draft is saveable as-is (AC-5 server side).
    expect(EvalCaseInput.safeParse(d).success).toBe(true);
  });

  it('a multi-line accepted finding keeps its end_line in the expectation', () => {
    const res = buildSeedDraft({
      finding: stripeFinding({
        file: 'src/api/public/webhooks.ts',
        startLine: 60,
        endLine: 61,
        title: 'SSRF',
      }),
      pull,
      patch: WEBHOOKS_PATCH,
      taken: new Set(),
    });
    if ('refused' in res) throw new Error(res.refused);
    expect(res.draft.expected_output[0]).toMatchObject({ start_line: 60, end_line: 61 });
  });

  it('AC-11/AC-12: a dismissed finding seeds must_not_flag with [] and the forbidden location', () => {
    const res = buildSeedDraft({
      finding: stripeFinding({ acceptedAt: null, dismissedAt: decided, title: 'Unused lodash import' }),
      pull,
      patch: CONFIG_PATCH,
      taken: new Set(),
    });
    if ('refused' in res) throw new Error(res.refused);
    expect(res.decision).toBe('dismissed');
    expect(res.draft.kind).toBe('must_not_flag');
    expect(res.draft.name).toBe('no-unused-lodash-import');
    expect(res.draft.expected_output).toEqual([]);
    expect(res.draft.forbidden_location).toEqual({ file: 'src/config.ts', start_line: 12, end_line: 12 });
    expect(EvalCaseInput.safeParse(res.draft).success).toBe(true);
  });

  it('AC-16 (helper): a name already taken in the agent set gets a suffix', () => {
    const res = buildSeedDraft({
      finding: stripeFinding(),
      pull,
      patch: CONFIG_PATCH,
      taken: new Set(['must-find-hardcoded-stripe-secret-key-in-commit']),
    });
    if ('refused' in res) throw new Error(res.refused);
    expect(res.draft.name).toBe('must-find-hardcoded-stripe-secret-key-in-commit-2');
  });

  it('AC-19: refuses with a message when undecided, with no stored patch, or on uncitable lines', () => {
    const undecided = buildSeedDraft({
      finding: stripeFinding({ acceptedAt: null }),
      pull,
      patch: CONFIG_PATCH,
      taken: new Set(),
    });
    expect(undecided).toEqual({ refused: expect.stringMatching(/accept or dismiss/i) });

    const noPatch = buildSeedDraft({ finding: stripeFinding(), pull, patch: null, taken: new Set() });
    expect(noPatch).toEqual({ refused: expect.stringContaining('src/config.ts') });

    const uncitable = buildSeedDraft({
      finding: stripeFinding({ startLine: 200, endLine: 204 }),
      pull,
      patch: CONFIG_PATCH,
      taken: new Set(),
    });
    expect(uncitable).toEqual({ refused: expect.stringContaining('200') });

    // A full-file kind (secret_leak) would pass the real gate on file presence
    // alone — seeding still demands citable lines.
    const secretLeak = buildSeedDraft({
      finding: { ...stripeFinding({ startLine: 300, endLine: 300 }), kind: 'secret_leak' } as ReturnType<
        typeof stripeFinding
      >,
      pull,
      patch: CONFIG_PATCH,
      taken: new Set(),
    });
    expect('refused' in secretLeak).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skill snapshots (R3)
// ---------------------------------------------------------------------------

const skill = (id: string, over: Partial<{ name: string; description: string; body: string; enabled: boolean; version: number }> = {}) => ({
  id,
  name: over.name ?? `Skill ${id}`,
  description: over.description ?? 'desc',
  body: over.body ?? 'body text',
  enabled: over.enabled ?? true,
  version: over.version ?? 1,
});

describe('skill snapshots', () => {
  it('pins every link in order with a sha256 of the rendered block', () => {
    const snap = buildSkillSnapshot([
      { skill: skill('b', { name: 'Beta' }), order: 1 },
      { skill: skill('a', { name: 'Alpha', enabled: false }), order: 0 },
    ]);
    expect(snap.map((s) => s.name)).toEqual(['Alpha', 'Beta']);
    expect(snap[0]!.enabled).toBe(false);
    const rendered = '### Beta\n_desc_\n\nbody text';
    expect(snap[1]!.rendered).toBe(rendered);
    expect(snap[1]!.content_hash).toBe(createHash('sha256').update(rendered).digest('hex'));
  });

  it('a description edit without a version bump is a different skill state (R3)', () => {
    const before = buildSkillSnapshot([{ skill: skill('a'), order: 0 }]);
    const after = buildSkillSnapshot([{ skill: skill('a', { description: 'edited' }), order: 0 }]);
    expect(before[0]!.version).toBe(after[0]!.version);
    expect(sameSkillState(before, after)).toBe(false);
    expect(skillDiff(before, after).changed).toEqual([
      { name: 'Skill a', from_version: 1, to_version: 1 },
    ]);
  });

  it('skillDiff reports added, removed and reordered skills', () => {
    const a = buildSkillSnapshot([
      { skill: skill('x', { name: 'X' }), order: 0 },
      { skill: skill('y', { name: 'Y' }), order: 1 },
      { skill: skill('gone', { name: 'Gone' }), order: 2 },
    ]);
    const b = buildSkillSnapshot([
      { skill: skill('y', { name: 'Y' }), order: 0 },
      { skill: skill('x', { name: 'X' }), order: 1 },
      { skill: skill('new', { name: 'New' }), order: 2 },
    ]);
    expect(skillDiff(a, b)).toEqual({ added: ['New'], removed: ['Gone'], reordered: true, changed: [] });
    expect(skillDiff(a, a)).toEqual({ added: [], removed: [], reordered: false, changed: [] });
    expect(sameSkillState(a, a)).toBe(true);
  });

  it('the wire DTO of a run never carries the server-only rendered text', () => {
    const snapshot = buildSkillSnapshot([{ skill: skill('a', { body: 'SECRET-BODY' }), order: 0 }]);
    const row = {
      id: 'r1',
      workspaceId: 'w',
      agentId: 'ag',
      agentVersion: 3,
      provider: 'openai',
      model: 'gpt-4.1',
      skillSnapshot: snapshot,
      caseIds: ['c1'],
      status: 'completed',
      casesTotal: 1,
      casesDone: 1,
      passed: 1,
      errored: 0,
      recall: 1,
      precision: null,
      citationAccuracy: 1,
      costUsd: null,
      durationMs: 10,
      startedAt: new Date('2026-09-01T00:00:00Z'),
      finishedAt: null,
      error: null,
    } as unknown as EvalAgentRunRow;
    const dto = toAgentRunDto(row);
    expect(dto.skill_snapshot).toHaveLength(1);
    expect(dto.skill_snapshot[0]).not.toHaveProperty('rendered');
    expect(JSON.stringify(dto)).not.toContain('SECRET-BODY');
    expect(dto.skill_snapshot[0]!.content_hash).toBe(snapshot[0]!.content_hash);
  });
});

// ---------------------------------------------------------------------------
// Deltas, precision dip, trend, compare
// ---------------------------------------------------------------------------

type Snap = Omit<EvalSkillSnapshotEntry, 'rendered'>;

function run(over: Partial<EvalAgentRun> & { agent_version: number; started_at: string }): EvalAgentRun {
  return {
    id: `run-v${over.agent_version}-${over.started_at}`,
    agent_id: 'agent-1',
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'completed',
    skill_snapshot: [],
    case_ids: ['c1', 'c2'],
    cases_total: 2,
    cases_done: 2,
    passed: 2,
    errored: 0,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    cost_usd: 0.02,
    duration_ms: 1000,
    finished_at: null,
    error: null,
    ...over,
  };
}

describe('metricDeltas / precisionDip (FR-21, D6)', () => {
  it('deltas are newer − older rounded to 4 decimals, and null against a null side (AC-49)', () => {
    expect(
      metricDeltas(
        { recall: 0.9, precision: null, citation_accuracy: 0.95 },
        { recall: 0.8, precision: 0.7, citation_accuracy: null },
      ),
    ).toEqual({ recall: 0.1, precision: null, citation_accuracy: null });
    expect(metricDeltas({ recall: 0.9, precision: 1, citation_accuracy: 1 }, null)).toEqual({
      recall: null,
      precision: null,
      citation_accuracy: null,
    });
  });

  it('AC-57: 0.93 → 0.91 is a 2-point dip on v7, with recall/citation movement', () => {
    const dip = precisionDip(
      { agent_version: 7, precision: 0.91, recall: 0.8, citation_accuracy: 0.9 },
      { precision: 0.93, recall: 0.85, citation_accuracy: 0.9 },
    );
    expect(dip).toEqual({ points: 2, version: 7, recall_delta: -0.05, citation_delta: 0 });
  });

  it('AC-58/AC-59: no banner below 1 point, on a rise, or when either precision is null', () => {
    const prev = { precision: 0.93, recall: 0.8, citation_accuracy: 0.9 };
    const at = (p: number | null) => ({ agent_version: 7, precision: p, recall: 0.8, citation_accuracy: 0.9 });
    expect(precisionDip(at(0.926), prev)).toBeNull(); // 0.4 pt
    expect(precisionDip(at(0.95), prev)).toBeNull(); // rise
    expect(precisionDip(at(0.93), prev)).toBeNull(); // flat
    expect(precisionDip(at(null), prev)).toBeNull();
    expect(precisionDip(at(0.5), { ...prev, precision: null })).toBeNull();
    expect(precisionDip(at(0.5), null)).toBeNull();
  });
});

describe('trendPoints (AC-55)', () => {
  it('keeps completed runs only, oldest → newest, with null metrics left null', () => {
    const points = trendPoints([
      run({ agent_version: 3, started_at: '2026-09-03T00:00:00.000Z', precision: null }),
      run({ agent_version: 1, started_at: '2026-09-01T00:00:00.000Z' }),
      run({ agent_version: 2, started_at: '2026-09-02T00:00:00.000Z', status: 'failed' }),
      run({ agent_version: 4, started_at: '2026-09-04T00:00:00.000Z', status: 'running' }),
    ]);
    expect(points.map((p) => p.version)).toEqual([1, 3]);
    expect(points[1]!.precision).toBeNull();
  });
});

describe('compareRuns (FR-22)', () => {
  const sX: Snap = { skill_id: 'x', name: 'X', version: 1, enabled: true, order: 0, content_hash: 'hx' };
  const sY: Snap = { skill_id: 'y', name: 'Y', version: 1, enabled: true, order: 1, content_hash: 'hy' };

  it('AC-60: orders older → newer whatever the argument order, with newer − older deltas', () => {
    const v7 = { run: run({ agent_version: 7, started_at: '2026-09-07T00:00:00.000Z', recall: 0.9, cost_usd: 0.05 }), prompt: 'prompt v7' };
    const v6 = { run: run({ agent_version: 6, started_at: '2026-09-06T00:00:00.000Z', recall: 0.7, cost_usd: 0.03 }), prompt: 'prompt v6' };
    const c = compareRuns(v7, v6, [], 8);
    expect(c.old.agent_version).toBe(6);
    expect(c.new.agent_version).toBe(7);
    expect(c.old_prompt).toBe('prompt v6');
    expect(c.new_prompt).toBe('prompt v7');
    expect(c.same_prompt).toBe(false);
    expect(c.delta).toEqual({ recall: 0.2, precision: 0, citation_accuracy: 0, cost_usd: 0.02 });
    expect(compareRuns(v6, v7, [], 8)).toEqual(c);
  });

  it('AC-62: same version + prompt, different skill snapshot → same prompt and the skill listed', () => {
    const a = { run: run({ agent_version: 2, started_at: '2026-09-01T00:00:00.000Z', skill_snapshot: [sX] }), prompt: 'p' };
    const b = { run: run({ agent_version: 2, started_at: '2026-09-02T00:00:00.000Z', skill_snapshot: [sX, sY] }), prompt: 'p' };
    const c = compareRuns(a, b, [sX, sY], 2);
    expect(c.same_prompt).toBe(true);
    expect(c.skill_diff.added).toEqual(['Y']);
    expect(c.no_config_change).toBe(false);
  });

  it('AC-63: identical version, prompt, model and skills → no config change', () => {
    const a = { run: run({ agent_version: 2, started_at: '2026-09-01T00:00:00.000Z', skill_snapshot: [sX] }), prompt: 'p' };
    const b = { run: run({ agent_version: 2, started_at: '2026-09-02T00:00:00.000Z', skill_snapshot: [sX] }), prompt: 'p' };
    const c = compareRuns(a, b, [sX], 2);
    expect(c.no_config_change).toBe(true);
    expect(c.model_change).toBeNull();
    expect(c.case_set).toEqual({ same: true, only_old: 0, only_new: 0 });
  });

  it('AC-64/AC-65: a model change and a case-set difference are reported', () => {
    const a = { run: run({ agent_version: 1, started_at: '2026-09-01T00:00:00.000Z', model: 'gpt-4.1', case_ids: ['a', 'b', 'c'] }), prompt: 'p' };
    const b = { run: run({ agent_version: 2, started_at: '2026-09-02T00:00:00.000Z', model: 'gpt-4o', case_ids: ['a', 'b', 'd', 'e'] }), prompt: 'p' };
    const c = compareRuns(a, b, [], 5);
    expect(c.model_change).toEqual({ from: 'gpt-4.1', to: 'gpt-4o' });
    expect(c.no_config_change).toBe(false);
    expect(c.case_set).toEqual({ same: false, only_old: 1, only_new: 2 });
  });

  it('AC-68/AC-69: promote targets the newer version, unavailable when active, flags a skill mismatch', () => {
    const a = { run: run({ agent_version: 6, started_at: '2026-09-01T00:00:00.000Z' }), prompt: 'p6' };
    const b = { run: run({ agent_version: 7, started_at: '2026-09-02T00:00:00.000Z', skill_snapshot: [sX] }), prompt: 'p7' };
    expect(compareRuns(a, b, [sX], 7).promote).toEqual({ version: 7, available: false, skill_mismatch: false });
    expect(compareRuns(a, b, [sX, sY], 8).promote).toEqual({ version: 7, available: true, skill_mismatch: true });
  });

  it('a cost delta is null when either run has no cost', () => {
    const a = { run: run({ agent_version: 1, started_at: '2026-09-01T00:00:00.000Z', cost_usd: null }), prompt: 'p' };
    const b = { run: run({ agent_version: 1, started_at: '2026-09-02T00:00:00.000Z' }), prompt: 'p' };
    expect(compareRuns(a, b, [], 1).delta.cost_usd).toBeNull();
  });
});
