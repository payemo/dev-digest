import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/eval.json";
import { makeRun } from "@/test/eval-fixtures";
import { EvalMetricTiles } from "./EvalMetricTiles";

afterEach(cleanup);

const renderTiles = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("EvalMetricTiles", () => {
  it("AC-28: with no completed run it shows an explicit empty state, never zeros", () => {
    renderTiles(
      <EvalMetricTiles latest={null} delta={{ recall: null, precision: null, citation_accuracy: null }} showTracesPassed />,
    );
    expect(screen.getByText("No completed runs yet")).toBeInTheDocument();
    expect(screen.queryByText("RECALL")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("AC-27/AC-49: values per tile, a delta only where both sides are applicable, and traces passed", () => {
    renderTiles(
      <EvalMetricTiles
        latest={makeRun({ recall: 0.82, precision: null, citation_accuracy: 0.9, passed: 6, cases_total: 8 })}
        // precision has a delta value but its latest value is not applicable → no delta may show.
        delta={{ recall: 0.04, precision: 0.05, citation_accuracy: null }}
        showTracesPassed
      />,
    );
    const recall = screen.getByTestId("eval-tile-recall");
    expect(within(recall).getByText("82")).toBeInTheDocument();
    expect(within(recall).getByText("0.04")).toBeInTheDocument();

    const precision = screen.getByTestId("eval-tile-precision");
    expect(within(precision).getByText("—")).toBeInTheDocument();
    expect(precision).not.toHaveTextContent("0.05");
    expect(precision).not.toHaveTextContent("%");

    const citation = screen.getByTestId("eval-tile-citation_accuracy");
    expect(within(citation).getByText("90")).toBeInTheDocument();
    expect(citation.textContent).toBe("CITATION ACCURACY90%");

    expect(within(screen.getByTestId("eval-tile-traces")).getByText("6/8")).toBeInTheDocument();
  });
});
