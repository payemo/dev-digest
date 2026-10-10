/* Test-only builders for eval DTOs (shapes from @devdigest/shared). Each
   builder returns a complete, schema-valid object; tests override only the
   fields they assert on. */
import type {
  EvalAgentRun,
  EvalCaseInput,
  EvalCaseRecord,
  EvalCaseResult,
  EvalCompare,
} from "@devdigest/shared";

export const STRIPE_DIFF = [
  "diff --git a/src/config.ts b/src/config.ts",
  "--- a/src/config.ts",
  "+++ b/src/config.ts",
  "@@ -10,3 +10,4 @@",
  "   port: 3000,",
  "+  stripeKey: 'sk_live_DEMO',",
].join("\n");

export function makeResult(over: Partial<EvalCaseResult> = {}): EvalCaseResult {
  return {
    id: "res-1",
    case_id: "case-1",
    case_name: "stripe-key-leak",
    case_kind: "must_find",
    suite_run_id: null,
    agent_version: 1,
    status: "passed",
    reason: null,
    emitted: 1,
    grounded: 1,
    expected_n: 1,
    got_m: 1,
    matched: [0],
    findings: [],
    duration_ms: 1800,
    cost_usd: 0.02,
    ran_at: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

export function makeCase(over: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "stripe-key-leak",
    kind: "must_find",
    input_diff: STRIPE_DIFF,
    input_files: [],
    input_meta: { title: "Add Stripe", number: 491, description: null, author: "demo" },
    expected_output: [
      { severity: "CRITICAL", category: "security", title: "Hardcoded key", file: "src/config.ts", start_line: 12 },
    ],
    forbidden_location: null,
    source_finding_id: null,
    source_decision: null,
    notes: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    last_result: null,
    source_available: false,
    ...over,
  };
}

export function makeRun(over: Partial<EvalAgentRun> = {}): EvalAgentRun {
  return {
    id: "run-1",
    agent_id: "agent-1",
    agent_version: 1,
    provider: "openai",
    model: "gpt-4.1",
    status: "completed",
    skill_snapshot: [],
    case_ids: ["case-1"],
    cases_total: 8,
    cases_done: 8,
    passed: 6,
    errored: 0,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cost_usd: 0.23,
    duration_ms: 12000,
    started_at: "2026-09-01T09:00:00.000Z",
    finished_at: "2026-09-01T09:01:00.000Z",
    error: null,
    ...over,
  };
}

export function makeCompare(over: Partial<EvalCompare> = {}): EvalCompare {
  return {
    old: makeRun({ id: "run-v6", agent_version: 6, recall: 0.7 }),
    new: makeRun({ id: "run-v7", agent_version: 7, recall: 0.8, started_at: "2026-09-02T09:00:00.000Z" }),
    delta: { recall: 0.1, precision: 0, citation_accuracy: 0, cost_usd: 0 },
    old_prompt: "You are a reviewer.\nFlag secrets.",
    new_prompt: "You are a reviewer.\nFlag secrets and SSRF.",
    same_prompt: false,
    model_change: null,
    skill_diff: { added: [], removed: [], reordered: false, changed: [] },
    no_config_change: false,
    case_set: { same: true, only_old: 0, only_new: 0 },
    promote: { version: 7, available: true, skill_mismatch: false },
    ...over,
  };
}

/** A must_find seeded draft for the "Hardcoded Stripe secret key" finding. */
export const POSITIVE_DRAFT: EvalCaseInput = {
  name: "must-find-hardcoded-stripe-secret-key-in-commit",
  kind: "must_find",
  input_diff: STRIPE_DIFF,
  input_files: [{ path: "src/config.ts", note: "reference only — not sent to the agent" }],
  input_meta: { number: 491, title: "Add Stripe checkout", description: "Wires Stripe.", author: "deepak.r" },
  expected_output: [
    {
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key in commit",
      file: "src/config.ts",
      start_line: 12,
    },
  ],
  forbidden_location: null,
  notes: null,
};
