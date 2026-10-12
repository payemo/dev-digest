import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentCandidate } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const push = vi.fn();
const mutateAsync = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

function candidate(id: string, name: string, avgMs: number | null): MultiAgentCandidate {
  return {
    agent_id: id,
    agent_name: name,
    provider: "openai",
    model: "gpt-4.1",
    description: "",
    latest_summary: null,
    estimate: { avg_duration_ms: avgMs, avg_cost_usd: avgMs ? 0.05 : null, sample_size: avgMs ? 3 : 0 },
  };
}
// The server only returns ENABLED agents, so a disabled one never reaches the picker.
const CANDIDATES = [
  candidate("a1", "Security", 6000),
  candidate("a2", "Performance", 7400),
  candidate("a3", "Junior Mentor", 6900),
  candidate("a4", "Architecture", null),
];
vi.mock("@/lib/hooks/multi-agent", () => ({
  useMultiAgentCandidates: () => ({ data: CANDIDATES, isLoading: false }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

beforeEach(() => {
  push.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({ pr_id: "pr1", runs: [], reviews: [], multi_agent_run_id: "m1" });
});
afterEach(cleanup);

function renderPicker() {
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunReviewDropdown prId="pr1" repoId="r1" prNumber={482} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Run Review/ }));
}

const runButton = () => screen.getByRole("button", { name: /Run multi-agent review/ });

describe("RunReviewDropdown agent picker", () => {
  it("opens with every enabled agent ticked, shows estimates or 'no estimate'", () => {
    renderPicker();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    expect(boxes.every((b) => b.getAttribute("aria-checked") === "true")).toBe(true);
    expect(runButton()).toHaveTextContent("(4)");
    expect(screen.getByText("~6.0s")).toBeInTheDocument();
    expect(screen.getByText("no estimate")).toBeInTheDocument();
  });

  it("Clear disables Run; ticking two runs exactly those and lands on the results page", async () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(runButton()).toHaveTextContent("(0)");
    expect(runButton()).toBeDisabled();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[2]!);
    expect(runButton()).toHaveTextContent("(2)");
    fireEvent.click(runButton());

    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/482"));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a3"] });
  });

  it("Run all ignores the ticks and posts {all:true}", async () => {
    renderPicker();
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: /Run all enabled agents/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", all: true }));
  });

  it("Configure agents… opens Configure run preselected on this PR", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /Configure agents/ }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/new?pr=482");
  });
});
