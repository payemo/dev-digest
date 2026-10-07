import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const runAll = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/eval", () => ({
  useRunAllEvals: () => ({ mutate: runAll, isPending: false, error: null }),
}));

import { RunAllAgentsButton } from "./RunAllAgentsButton";

afterEach(() => {
  cleanup();
  runAll.mockReset();
});

const summary = (id: string, cases: number): EvalAgentSummary => ({
  agent_id: id,
  agent_name: id,
  model: "gpt-4.1",
  cases_total: cases,
  latest: null,
  recall_series: [],
  in_flight: false,
});

describe("RunAllAgentsButton", () => {
  it("AC-53: states how many agents and cases will run before starting anything", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <RunAllAgentsButton agents={[summary("sec", 9), summary("perf", 4)]} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Run 2 agents on 13 cases?");
    expect(runAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(runAll).toHaveBeenCalledTimes(1);
  });
});
