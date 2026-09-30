/* OverviewTab — the brief replaces the standalone Intent and Blast cards only
   once a brief exists (A-4, NFR-8). While the brief is loading, absent, or its
   read failed, the standalone cards keep rendering, so the Overview never
   loses context it had before this feature.

   Mocked at the `src/lib/hooks/*` seam only. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefRecord } from "@devdigest/shared";
import brief from "../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import blast from "../../../../../../../../messages/en/blast.json";

let briefQuery: { data: PrBriefRecord | null | undefined; isLoading: boolean; isError: boolean } = {
  data: null,
  isLoading: false,
  isError: false,
};

vi.mock("@/lib/hooks/reviews", () => ({
  usePrBrief: () => briefQuery,
  useGeneratePrBrief: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  usePrReviews: () => ({ data: [] }),
  usePrIntent: () => ({ data: null, isLoading: false }),
  useDerivePrIntent: () => ({ mutate: vi.fn(), isPending: false }),
  usePrBlastRadius: () => ({ data: undefined, isLoading: true, isError: false }),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  briefQuery = { data: null, isLoading: false, isError: false };
});

const RECORD: PrBriefRecord = {
  summary: "Adds per-token rate limiting.",
  intent: null,
  blast: null,
  risks: { risks: [] },
  review_focus: [],
  history: { history: [] },
  pr_id: "pr-1",
  head_sha: "a1b2c3d4",
  generated_at: "2026-09-30T12:00:00.000Z",
  provider: "openai",
  model: "gpt-4.1",
  attempts: 1,
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.001,
  input_tokens_measured: 90,
  truncated_sections: [],
  inputs: {
    intent: "present",
    blast: "present",
    description: "present",
    linked_issue: "present",
    project_context: "present",
  },
  validation: {
    risks_dropped: 0,
    refs_stripped: 0,
    focus_dropped: 0,
    focus_snapped: 0,
    duplicates_collapsed: 0,
  },
  is_stale: false,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview, blast }}>
      <OverviewTab
        prId="pr-1"
        prBody="The author's own description."
        repoId="repo-1"
        repoFullName="acme/api"
        headSha="a1b2c3d4"
        onOpenInDiff={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("OverviewTab", () => {
  it("with no brief, shows the empty brief card above the standalone Intent and Blast cards", () => {
    renderTab();
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByText("The author's own description.")).toBeInTheDocument();
  });

  it("keeps the standalone cards when the brief read fails", () => {
    briefQuery = { data: undefined, isLoading: false, isError: true };
    renderTab();
    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
  });

  it("with a brief, shows it and hides the standalone cards, keeping the description", () => {
    briefQuery = { data: RECORD, isLoading: false, isError: false };
    renderTab();
    expect(screen.getByText("Adds per-token rate limiting.")).toBeInTheDocument();
    expect(screen.queryByText("No intent derived yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Blast radius")).not.toBeInTheDocument();
    expect(screen.getByText("The author's own description.")).toBeInTheDocument();
  });
});
