/* Multi-Agent Review fixtures shared by the route's component tests. */
import type { FindingRecord, MultiAgentColumn, MultiAgentRunView } from "@devdigest/shared";

export function maFinding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "A live key is committed.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

export function maColumn(over: Partial<MultiAgentColumn> = {}): MultiAgentColumn {
  return {
    run_id: "run1",
    agent_id: "agent1",
    agent_name: "Security",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    error: null,
    verdict: "request_changes",
    score: 38,
    summary: "Two critical exposures.",
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [maFinding()],
    ...over,
  };
}

export function maView(over: Partial<MultiAgentRunView> = {}): MultiAgentRunView {
  return {
    id: "parent1",
    pr_id: "pr1",
    pr_number: 482,
    pr_title: "Add rate limiting",
    repo_id: "repo1",
    ran_at: "2026-10-10T00:00:00.000Z",
    status: "done",
    agent_count: 2,
    total_duration_ms: 8200,
    total_cost_usd: 0.11,
    failed_cost_usd: null,
    columns: [maColumn(), maColumn({ run_id: "run2", agent_id: "agent2", agent_name: "Performance", findings: [] })],
    groups: [],
    disagreements: [],
    ...over,
  };
}
