/* DiffTab — the two controls above the diff and the degradation path.
   `fetch` never runs here: the hooks module is mocked at its seam, which is
   also why only the server's own suite can catch a response-shape change. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const smartDiffResult = { data: undefined as SmartDiff | undefined, isError: false };
const reviewsResult = { data: undefined as ReviewRecord[] | undefined };

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => reviewsResult,
  useSmartDiff: () => smartDiffResult,
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  smartDiffResult.data = undefined;
  smartDiffResult.isError = false;
  reviewsResult.data = undefined;
});

const PATCH = ["@@ -1,1 +1,2 @@", " const a = 1;", "+const b = 2;"].join("\n");

const FILES: PrFile[] = [
  { path: "src/pay.ts", additions: 20, deletions: 2, patch: PATCH },
  { path: "pnpm-lock.yaml", additions: 120, deletions: 8, patch: PATCH },
];

function smartDiff(): SmartDiff {
  const f = (path: string) => ({
    path,
    pseudocode_summary: null,
    additions: 0,
    deletions: 0,
    finding_lines: [],
  });
  return {
    groups: [
      { role: "core", files: [f("src/pay.ts")] },
      { role: "tests", files: [] },
      { role: "wiring", files: [] },
      { role: "docs", files: [] },
      { role: "boilerplate", files: [f("pnpm-lock.yaml")] },
    ],
    split_suggestion: { too_big: false, total_lines: 150, proposed_splits: [] },
  };
}

const REVIEW: ReviewRecord = {
  id: "r1",
  pr_id: "pr-1",
  agent_id: null,
  run_id: null,
  agent_name: null,
  kind: "review",
  verdict: "comment",
  summary: null,
  score: 70,
  model: "test/model",
  grounding: null,
  created_at: "2026-01-01T00:00:00Z",
  findings: [
    {
      id: "f1",
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
      file: "src/pay.ts",
      start_line: 2,
      end_line: 2,
      rationale: "A live key is committed.",
      suggestion: null,
      confidence: 0.95,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "r1",
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr-1" filesCount={FILES.length} files={FILES} canComment />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab", () => {
  it("swaps the grouped view for the flat list on Original order, and back on Smart order", () => {
    smartDiffResult.data = smartDiff();
    renderTab();

    expect(screen.getByText("Reviewer-ordered diff")).toBeInTheDocument();
    expect(screen.getByText("2 files · +140 −10")).toBeInTheDocument();
    // Grouped: the five role regions exist and boilerplate starts collapsed.
    expect(screen.getAllByRole("region")).toHaveLength(5);
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    // The order control really is a pair of buttons — queried by role.
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    // Flat: every file is listed, in GitHub order.
    expect(screen.getByText("src/pay.ts")).toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getAllByRole("region")).toHaveLength(5);
  });

  it("hides the finding bodies with the shared toggle while leaving the dot", () => {
    smartDiffResult.data = smartDiff();
    reviewsResult.data = [REVIEW];
    renderTab();

    // Findings start hidden, like comments — the dot still marks the file.
    expect(screen.getByTestId("finding-dot")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show comments/ }));

    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    // The severity label is text, never a button.
    expect(screen.getByText("blocker")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide comments/ }));

    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
    expect(screen.getByTestId("finding-dot")).toBeInTheDocument();
  });

  it("falls back to the flat list with a muted note when /smart-diff fails", () => {
    smartDiffResult.isError = true;
    renderTab();

    expect(
      screen.getByText("Couldn’t group this diff by role — showing GitHub order"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByText("src/pay.ts")).toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });
});
