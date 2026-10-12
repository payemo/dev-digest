import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRunView } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgent.json";
import { maView } from "@/test/multi-agent-fixtures";
import { ResultsHeader } from "./ResultsHeader";

afterEach(cleanup);

function renderHeader(view: MultiAgentRunView, onMode = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ResultsHeader view={view} mode="columns" onMode={onMode} onConfigure={vi.fn()} onNewRun={vi.fn()} />
    </NextIntlClientProvider>,
  );
  return onMode;
}

describe("ResultsHeader", () => {
  it("shows totals and the failed-run cost only when it is known (AC-55)", () => {
    renderHeader(maView());
    expect(screen.getByTestId("results-totals")).toHaveTextContent("2 agents · 8.2s total · $0.110");
    expect(screen.queryByText(/on failed runs/)).toBeNull();
    cleanup();

    const onMode = renderHeader(maView({ status: "partial", failed_cost_usd: 0.02 }));
    expect(screen.getByText("+ $0.020 on failed runs")).toBeInTheDocument();
    expect(screen.getByText("partial")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(onMode).toHaveBeenCalledWith("tabs");
  });
});
