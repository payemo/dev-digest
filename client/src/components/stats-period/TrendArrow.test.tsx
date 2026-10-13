import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/agentPerformance.json";
import { TrendArrow } from "./TrendArrow";

/* The accept-trend arrow is evidence-gated by the server (AC9). Breakage
   covered: an arrow drawn for a null trend (invented from a small sample),
   the wrong direction label, or a missing signed delta. */

afterEach(cleanup);

const renderArrow = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );

describe("TrendArrow", () => {
  it("labels up, down and flat with the signed point delta", () => {
    renderArrow(
      <>
        <TrendArrow trend="up" deltaPp={20} />
        <TrendArrow trend="down" deltaPp={-5} />
        <TrendArrow trend="flat" deltaPp={0} />
      </>,
    );
    expect(screen.getByRole("img", { name: "+20 pts vs previous period" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "-5 pts vs previous period" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "0 pts vs previous period" })).toBeInTheDocument();
  });

  it("renders no arrow for a null trend, only an explanation of why", () => {
    renderArrow(<TrendArrow trend={null} deltaPp={null} minDecisions={10} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByTitle("Not enough decisions in one of the periods (min 10)")).toBeInTheDocument();
  });
});
