import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/agentPerformance.json";
import { CostDonut } from "./CostDonut";

/* CostDonut exists because the vendored Donut rounds every value to cents.
   Breakage covered: sub-cent slices collapsing to "$0.00", a $0 slice
   vanishing from the legend, the footer total drifting from the passed
   total, and a ring drawn when nothing was spent. */

afterEach(cleanup);

const renderDonut = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("CostDonut", () => {
  it("shows sub-cent slice values at full precision, keeps $0 slices, and totals what it was given", () => {
    renderDonut(
      <CostDonut
        slices={[
          { key: "a", label: "Security Reviewer", costUsd: 0.0012, color: "red" },
          { key: "b", label: "Perf Reviewer", costUsd: 0.0003, color: "blue" },
          { key: "c", label: "Idle Reviewer", costUsd: 0, color: "green" },
        ]}
        total={0.0015}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Security Reviewer")).toBeInTheDocument();
    expect(within(items[0]!).getByText("$0.0012")).toBeInTheDocument();
    expect(within(items[1]!).getByText("$0.0003")).toBeInTheDocument();
    expect(within(items[2]!).getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("Total $0.0015")).toBeInTheDocument();
    expect(screen.queryByText("No cost recorded")).not.toBeInTheDocument();
  });

  it("replaces the ring with a message when no cost was recorded", () => {
    renderDonut(<CostDonut slices={[{ key: "unknown", label: "Unknown model", costUsd: 0, color: "red" }]} total={null} />);
    expect(screen.getByText("No cost recorded")).toBeInTheDocument();
    expect(screen.getByText("Total —")).toBeInTheDocument();
  });
});
