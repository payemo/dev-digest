/**
 * ReviewRunAccordion — the severity counters belong to ONE run: they count that
 * run's findings only, and filtering by a severity narrows the cards listed
 * right below them (clicking the active chip again restores the full list).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord, Severity } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

function finding(severity: Severity, title: string): FindingRecord {
  return {
    id: `f-${title}`,
    severity,
    category: "security",
    title,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Because of reasons.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  };
}

const REVIEW: ReviewRecord = {
  id: "r1",
  pr_id: "pr1",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: "Two blockers.",
  score: 38,
  model: "deepseek/deepseek-v4-flash",
  created_at: "2026-06-13T18:52:51.000Z",
  findings: [
    finding("CRITICAL", "Hardcoded Stripe key"),
    finding("CRITICAL", "Lethal trifecta"),
    finding("WARNING", "Retry-After header omitted"),
  ],
};

function renderAccordion() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ReviewRunAccordion review={REVIEW} prId="pr1" defaultOpen />
    </NextIntlClientProvider>,
  );
}

describe("ReviewRunAccordion — severity counters", () => {
  it("counts only this run's findings, and omits absent severities", () => {
    renderAccordion();
    expect(screen.getByRole("button", { name: /CRITICAL/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /WARNING/ })).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: /SUGGESTION/ })).not.toBeInTheDocument();
  });

  it("filters the findings below to the clicked severity, and restores on a second click", () => {
    renderAccordion();
    expect(screen.getByText("Retry-After header omitted")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/ }));
    expect(screen.getByText("Hardcoded Stripe key")).toBeInTheDocument();
    expect(screen.getByText("Lethal trifecta")).toBeInTheDocument();
    expect(screen.queryByText("Retry-After header omitted")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/ }));
    expect(screen.getByText("Retry-After header omitted")).toBeInTheDocument();
  });
});
