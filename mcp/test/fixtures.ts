import type {
  Agent,
  ConventionCandidate,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
} from '@devdigest/shared';

/** Minimal, valid-shaped rows. Each helper takes overrides for the field under test. */

export function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner: 'acme',
    name: 'payments-api',
    full_name: 'acme/payments-api',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...over,
  };
}

export function pull(over: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 42,
    title: 'Add rate limiting',
    author: 'dev',
    branch: 'feat/rl',
    base: 'main',
    head_sha: 'abc123',
    additions: 10,
    deletions: 2,
    files_count: 3,
    status: 'open',
    ...over,
  };
}

export function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    description: 'Looks for injection and authz mistakes.',
    provider: 'openai',
    model: 'gpt-4o-mini',
    // Long on purpose: the projection must never let this reach a model.
    system_prompt: 'SUPERSECRETPROMPT '.repeat(200),
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...over,
  };
}

export function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'f-1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Unvalidated repo id reaches the clone path',
    file: 'src/repos/service.ts',
    start_line: 42,
    end_line: 50,
    rationale: 'R'.repeat(900),
    confidence: 0.8,
    trifecta_components: ['untrusted_input'],
    evidence: [{ kind: 'untrusted_input', file: 'a.ts', start_line: 1, end_line: 2, quote: 'x' }],
    review_id: 'rev-1',
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

export function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'S'.repeat(900),
    score: 55,
    model: 'gpt-4o-mini',
    created_at: '2026-09-20T10:00:00.000Z',
    findings: [finding()],
    ...over,
  };
}

export function convention(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'c-1',
    repo_id: 'repo-1',
    category: 'naming',
    rule: 'Modules are kebab-case folders.',
    rationale: 'Consistent with every existing module.',
    evidence_path: 'src/modules/smart-diff/routes.ts',
    evidence_line: 1,
    evidence_snippet: 'RAWSNIPPET '.repeat(50),
    confidence: 0.9,
    status: 'approved',
    created_at: null,
    updated_at: null,
    ...over,
  };
}
