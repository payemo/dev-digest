import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";
import { PrecisionDipBanner } from "./PrecisionDipBanner";

afterEach(cleanup);

describe("PrecisionDipBanner", () => {
  it("AC-57: renders the dip in points on the version, with recall/citation movement", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <PrecisionDipBanner alert={{ points: 2, version: 7, recall_delta: -0.03, citation_delta: null }} />
      </NextIntlClientProvider>,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Precision dipped 2pts on v7");
    expect(banner).toHaveTextContent("Recall down 3pt · citation n/a.");
  });
});
