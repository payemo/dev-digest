import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DisagreementRow } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgent.json";
import { maColumn } from "@/test/multi-agent-fixtures";
import { Disagreements } from "./Disagreements";

afterEach(cleanup);

const columns = [
  maColumn({ run_id: "r1", agent_name: "Junior Mentor" }),
  maColumn({ run_id: "r2", agent_name: "Security" }),
  maColumn({ run_id: "r3", agent_name: "Architecture" }),
];
const rows: DisagreementRow[] = [
  {
    group_id: "a",
    file: "src/middleware/ratelimit.ts",
    line: 28,
    title: "Magic number 3600",
    conflict: true,
    takes: [
      { kind: "flagged", run_id: "r1", agent_id: null, severity: "SUGGESTION", note: "Extract for readability.", finding_ids: ["f"] },
      { kind: "did_not_flag", run_id: "r2", agent_id: null },
      { kind: "did_not_flag", run_id: "r3", agent_id: null },
    ],
  },
  {
    group_id: "b",
    file: "src/api/users.ts",
    line: 45,
    title: "N+1 query",
    conflict: false,
    takes: [
      { kind: "flagged", run_id: "r1", agent_id: null, severity: "WARNING", note: "Batch it.", finding_ids: ["g"] },
      { kind: "no_result", run_id: "r2", agent_id: null },
      { kind: "pending", run_id: "r3", agent_id: null },
    ],
  },
];

function renderBlock(cols = columns, r = rows) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <Disagreements rows={r} columns={cols} />
    </NextIntlClientProvider>,
  );
}

describe("Disagreements", () => {
  it("lists every location, one identical note per did-not-flag, and filters to conflicts (AC-35, AC-36, AC-37, AC-60)", () => {
    renderBlock();
    expect(screen.getAllByTestId("disagreement-row")).toHaveLength(2);
    expect(screen.getAllByText("No finding at this location.")).toHaveLength(2);
    expect(screen.getByText("Extract for readability.")).toBeInTheDocument();
    expect(screen.getByText("no result")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Show only conflicts" }));
    expect(screen.getAllByTestId("disagreement-row")).toHaveLength(1);
    expect(screen.queryByText("N+1 query")).toBeNull();
  });

  it("renders nothing with fewer than 2 columns, and the all-failed state when none is done", () => {
    renderBlock([columns[0]!], rows);
    expect(screen.queryByText("Where agents disagree")).toBeNull();
    cleanup();
    renderBlock(
      [maColumn({ run_id: "x", status: "failed" }), maColumn({ run_id: "y", status: "failed" })],
      [],
    );
    expect(screen.getByText(/Every agent failed/)).toBeInTheDocument();
  });
});
