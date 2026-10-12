import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgent.json";

const push = vi.fn();
const mutate = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ data: [{ id: "pr-uuid", number: 482, title: "Add rate limiting" }] }),
}));

function c(id: string, name: string, ms: number | null, usd: number | null, n = 4): MultiAgentCandidate {
  return {
    agent_id: id,
    agent_name: name,
    provider: "openai",
    model: "m",
    description: `${name} description`,
    latest_summary: id === "a1" ? "Two critical exposures. Block." : null,
    estimate: { avg_duration_ms: ms, avg_cost_usd: usd, sample_size: n },
  };
}
let candidates: MultiAgentCandidate[] = [];
vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentCandidates: (prId: string | null) => ({
    data: prId ? candidates : undefined,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutate, isPending: false }),
}));

import { ConfigureRun } from "./ConfigureRun";

beforeEach(() => {
  push.mockReset();
  mutate.mockReset();
  candidates = [
    c("a1", "Security", 8200, 0.06),
    c("a2", "Performance", 7400, 0.05),
    c("a3", "Junior Mentor", 6900, 0.04),
    c("a4", "Customer-Facing", 7100, 0.05),
  ];
});
afterEach(cleanup);

function renderConfigure(initialPrNumber: number | null) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ConfigureRun repoId="r1" initialPrNumber={initialPrNumber} />
    </NextIntlClientProvider>,
  );
}
const runButton = () => screen.getByRole("button", { name: /Run multi-agent review/ });

describe("ConfigureRun", () => {
  it("with no PR asks to pick one first and keeps Run disabled (AC-6)", () => {
    renderConfigure(null);
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(runButton()).toBeDisabled();
    expect(screen.queryAllByTestId("agent-card")).toHaveLength(0);
  });

  it("preselects the PR, ticks every card, totals the selection and starts the run (AC-5, AC-9, AC-11)", () => {
    renderConfigure(482);
    expect(screen.getAllByTestId("agent-card")).toHaveLength(4);
    expect(runButton()).toHaveTextContent("(4)");
    expect(screen.getByTestId("selection-total")).toHaveTextContent("≈ 8.2s · $0.20 · parallel fan-out");
    // Plain-text latest summary wins over the description.
    expect(screen.getByText("Two critical exposures. Block.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(runButton()).toHaveTextContent("(3)");
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(runButton()).toHaveTextContent("(4)");

    fireEvent.click(runButton());
    expect(mutate).toHaveBeenCalledWith(
      { prId: "pr-uuid", agentIds: ["a1", "a2", "a3", "a4"] },
      expect.anything(),
    );
    mutate.mock.calls[0]![1].onSuccess();
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/482");
  });

  it("marks the total partial when a ticked agent has no estimate (AC-12)", () => {
    candidates = [...candidates, c("a5", "Architecture", null, null, 0)];
    renderConfigure(482);
    expect(screen.getByText("no estimate")).toBeInTheDocument();
    expect(screen.getByTestId("selection-total")).toHaveTextContent("partial estimate");
  });
});
