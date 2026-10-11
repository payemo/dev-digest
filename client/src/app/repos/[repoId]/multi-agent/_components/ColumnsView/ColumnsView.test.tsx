import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/multiAgent.json";
import { maColumn, maFinding } from "@/test/multi-agent-fixtures";

vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: true }),
}));

import { ColumnsView } from "./ColumnsView";

afterEach(cleanup);

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
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ColumnsView columns={columns} onOpenFinding={onOpenFinding} onOpenTrace={onOpenTrace} />
    </NextIntlClientProvider>,
  );
  return { onOpenFinding, onOpenTrace };
}

describe("ColumnsView", () => {
  it("is read-only and a finding opens Tabs + detail for that run (AC-28, AC-29)", () => {
    const { onOpenFinding, onOpenTrace } = renderColumns();
    expect(screen.queryByRole("button", { name: /Accept|Reject|Dismiss|Learn|eval/i })).toBeNull();

    const security = screen.getByRole("region", { name: "Security" });
    expect(within(security).getByText("2 findings")).toBeInTheDocument();
    fireEvent.click(within(security).getByRole("button", { name: /Second/ }));
    expect(onOpenFinding).toHaveBeenCalledWith("run1", "f2");

    fireEvent.click(within(security).getByRole("button", { name: "View trace" }));
    expect(onOpenTrace).toHaveBeenCalledWith("run1");
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
