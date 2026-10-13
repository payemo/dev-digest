import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../messages/en/eval.json";
import { maColumn, maFinding } from "@/test/multi-agent-fixtures";

const mutate = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false, variables: undefined }),
  useRunEvents: () => ({ events: [], running: true }),
}));
// The eval-case modal is never opened here; keep its hooks inert.
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseSeed: () => ({ data: undefined, isLoading: false }),
  useCreateCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

import { ColumnsView } from "./ColumnsView";

afterEach(() => {
  cleanup();
  mutate.mockReset();
});

const columns = [
  maColumn({ findings: [maFinding({ id: "f1" }), maFinding({ id: "f2", title: "Second", start_line: 61 })] }),
  maColumn({
    run_id: "run2",
    agent_id: "agent2",
    agent_name: "Architecture",
    status: "failed",
    error: "provider exploded",
    score: null,
    findings: [],
    cost_usd: null,
  }),
  maColumn({ run_id: "run3", agent_id: "agent3", agent_name: "Mentor", status: "running", score: null, findings: [] }),
];

function renderColumns(onOpenFinding = vi.fn(), onOpenTrace = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages, prReview, eval: evalMessages }}>
      <ColumnsView columns={columns} prId="pr1" onOpenFinding={onOpenFinding} onOpenTrace={onOpenTrace} />
    </NextIntlClientProvider>,
  );
  return { onOpenFinding, onOpenTrace };
}

describe("ColumnsView", () => {
  it("a finding opens Tabs + detail for that run, and the trace opens (AC-28)", () => {
    const { onOpenFinding, onOpenTrace } = renderColumns();
    const security = screen.getByRole("region", { name: "Security" });
    expect(within(security).getByText("2 findings")).toBeInTheDocument();
    fireEvent.click(within(security).getByRole("button", { name: /Second/ }));
    expect(onOpenFinding).toHaveBeenCalledWith("run1", "f2");

    fireEvent.click(within(security).getByRole("button", { name: "View trace" }));
    expect(onOpenTrace).toHaveBeenCalledWith("run1");
  });

  it("each finding carries Accept / Dismiss / eval case / disabled Learn that act in place", () => {
    const { onOpenFinding } = renderColumns();
    const security = screen.getByRole("region", { name: "Security" });
    expect(within(security).getAllByRole("button", { name: "Accept" })).toHaveLength(2);
    expect(within(security).getAllByRole("button", { name: "Reject" })).toHaveLength(2);
    expect(within(security).getAllByRole("button", { name: "Turn into eval case" })[0]).toBeDisabled();
    const learn = within(security).getAllByRole("button", { name: "Learn" });
    expect(learn[0]).toBeDisabled();

    fireEvent.click(within(security).getAllByRole("button", { name: "Accept" })[1]!);
    expect(mutate).toHaveBeenCalledWith({ findingId: "f2", action: "accept", prId: "pr1" });
    fireEvent.click(within(security).getAllByRole("button", { name: "Reject" })[0]!);
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "dismiss", prId: "pr1" });
    // Acting does not navigate away.
    expect(onOpenFinding).not.toHaveBeenCalled();
  });

  it("shows a failed column's error and no score; a running column shows a progress bar", () => {
    renderColumns();
    const failed = screen.getByRole("region", { name: "Architecture" });
    expect(within(failed).getByText("provider exploded")).toBeInTheDocument();
    expect(within(failed).getByText("failed")).toBeInTheDocument();
    // Unknown cost renders as a dash, never $0.00.
    expect(within(failed).queryByText(/\$0\.00/)).toBeNull();
    expect(within(failed).queryByText("38")).toBeNull();

    const running = screen.getByRole("region", { name: "Mentor" });
    expect(within(running).getByText("running")).toBeInTheDocument();
    // Narrow columns show a progress bar, not the log stream, and no trace until the run settles.
    expect(within(running).getByRole("progressbar")).toBeInTheDocument();
    expect(within(running).queryByRole("button", { name: "View trace" })).toBeNull();
  });
});
