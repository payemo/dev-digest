import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import { makeCase, makeResult, makeRun } from "@/test/eval-fixtures";

// Every server call of the tab goes through these hooks — mocked at that seam.
const state = vi.hoisted(() => ({
  cases: [] as unknown[],
  detail: {} as Record<string, unknown>,
  start: vi.fn(),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalAgentDetail: () => ({ data: state.detail, isLoading: false, isError: false }),
  useEvalCases: () => ({ data: state.cases, isLoading: false, isError: false }),
  useEvalAgentRuns: () => ({ data: [], isLoading: false }),
  useEvalRunWatcher: () => ({ data: undefined }),
  useStartEvalRun: () => ({ mutate: state.start, isPending: false }),
  useRunEvalCase: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteEvalCase: () => ({ mutate: vi.fn() }),
  useEvalCaseSeed: () => ({ isLoading: true }),
  useCreateCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

import { EvalsTab } from "./EvalsTab";

const AGENT = { id: "agent-1", name: "Security Reviewer" } as Agent;

function detail(over: Record<string, unknown> = {}) {
  return {
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    model: "gpt-4.1",
    cases_total: 9,
    runs_in_window: 1,
    window_days: 30,
    latest: makeRun({ passed: 6, cases_total: 9 }),
    delta: { recall: null, precision: null, citation_accuracy: null },
    trend: [],
    recent_runs: [],
    in_flight: null,
    alert: null,
    ...over,
  };
}

/** 9 cases: 6 passed, 2 failed, 1 never run; 6 must_find and 3 must_not_flag. */
function nineCases(): EvalCaseRecord[] {
  const status = ["passed", "passed", "passed", "passed", "passed", "passed", "failed", "failed", null] as const;
  return status.map((st, i) =>
    makeCase({
      id: `c${i}`,
      name: `case-${i}`,
      ...(i >= 6 ? { kind: "must_not_flag" as const, expected_output: [] } : {}),
      last_result: st ? makeResult({ id: `r${i}`, case_id: `c${i}`, status: st }) : null,
    }),
  );
}

function renderTab() {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  state.start.mockReset();
  state.cases = nineCases();
  state.detail = detail();
});
afterEach(cleanup);

describe("EvalsTab", () => {
  it("AC-29/AC-30: header counts and a kind badge on every case; Run all starts a run", () => {
    renderTab();
    expect(screen.getByText("6 / 8 passing")).toBeInTheDocument();
    expect(screen.getByText("9 cases")).toBeInTheDocument();
    expect(screen.getAllByTestId("eval-case-row")).toHaveLength(9);
    expect(screen.getAllByText("MUST FIND")).toHaveLength(6);
    expect(screen.getAllByText("MUST NOT FLAG")).toHaveLength(3);
    expect(screen.getAllByText("never run").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Scoring is mechanical/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(state.start).toHaveBeenCalledWith("agent-1");
  });

  it("AC-81/AC-82: with a run in flight the tab shows its progress and offers no new start", () => {
    state.detail = detail({ in_flight: makeRun({ id: "live", status: "running", cases_done: 3, cases_total: 9 }) });
    renderTab();
    expect(screen.getByText("3 / 9 cases")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run all evals" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Running…/ }));
    expect(state.start).not.toHaveBeenCalled();
  });

  it("AC-28: with no cases and no runs, Run all is disabled and the tiles show the empty state", () => {
    state.cases = [];
    state.detail = detail({ latest: null, cases_total: 0 });
    renderTab();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    expect(screen.getByText("No completed runs yet")).toBeInTheDocument();
    expect(screen.getByText("0 / 0 passing")).toBeInTheDocument();
  });
});
