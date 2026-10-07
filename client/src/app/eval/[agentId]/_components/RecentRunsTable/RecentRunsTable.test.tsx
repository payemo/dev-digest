import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";
import { makeRun } from "@/test/eval-fixtures";
import { RecentRunsTable } from "./RecentRunsTable";

afterEach(cleanup);

describe("RecentRunsTable", () => {
  it("AC-56: Compare is enabled iff exactly two runs are selected", () => {
    const onCompare = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <RecentRunsTable
          runs={[
            makeRun({ id: "r8", agent_version: 8 }),
            makeRun({ id: "r7", agent_version: 7 }),
            makeRun({ id: "r6", agent_version: 6, status: "failed", error: "Interrupted by a server restart" }),
          ]}
          onCompare={onCompare}
        />
      </NextIntlClientProvider>,
    );
    const compare = () => screen.getByRole("button", { name: "Compare" });
    const pick = (v: number) => fireEvent.click(screen.getByRole("checkbox", { name: `Select run v${v}` }));

    expect(compare()).toBeDisabled();
    pick(7);
    expect(compare()).toBeDisabled();
    pick(6);
    expect(compare()).toBeEnabled();
    pick(8);
    expect(compare()).toBeDisabled();
    pick(8);
    fireEvent.click(compare());
    expect(onCompare).toHaveBeenCalledWith("r7", "r6");
    // A failed run is listed with its status, not with a pass count (AC-84).
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
