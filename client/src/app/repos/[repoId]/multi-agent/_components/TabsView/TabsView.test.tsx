import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../messages/en/eval.json";
import { maColumn, maFinding } from "@/test/multi-agent-fixtures";

const mutate = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false, variables: undefined }),
  useRunEvents: () => ({ events: [], running: true }),
}));
// FindingCard's eval-case modal is never opened here; keep its hooks inert.
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseSeed: () => ({ data: undefined, isLoading: false }),
  useCreateCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

import { TabsView } from "./TabsView";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const columns = [
  maColumn({ findings: [maFinding({ id: "f1" }), maFinding({ id: "f2", title: "Lethal trifecta" })] }),
  maColumn({ run_id: "run2", agent_id: "agent2", agent_name: "Performance", status: "running", findings: [] }),
];

function renderTabs(activeRunId: string | null, expandedFindingId: string | null, onSelect = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, prReview, eval: evalMessages }}>
      <TabsView
        columns={columns}
        activeRunId={activeRunId}
        expandedFindingId={expandedFindingId}
        prId="pr1"
        onSelect={onSelect}
        onOpenTrace={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

describe("TabsView", () => {
  it("expands the deep-linked finding with Accept wired and Learn disabled (AC-32, AC-40, AC-43)", () => {
    renderTabs("run1", "f2");
    expect(screen.getByText("Two critical exposures.")).toBeInTheDocument();
    const learn = screen.getByRole("button", { name: "Learn" });
    expect(learn).toBeDisabled();
    expect(learn.parentElement).toHaveAttribute("title", "Coming soon");
    fireEvent.click(learn);
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f2", action: "accept", prId: "pr1" });
  });

  it("a running tab shows its live status instead of findings (AC-42)", () => {
    const onSelect = renderTabs("run2", null);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Security"));
    expect(onSelect).toHaveBeenCalledWith("run1");
  });
});
