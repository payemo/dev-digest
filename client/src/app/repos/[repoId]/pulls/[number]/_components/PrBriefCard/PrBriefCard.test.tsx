/**
 * PrBriefCard — the PR Brief's states on the Overview (L05, plan Steps 15/18).
 *
 * Generating costs a model call, so which state the user sees is the whole
 * behaviour: loading must not offer the paid CTA, a failed regenerate must not
 * wipe the brief already on screen, and model text must render as text.
 *
 * Mocked at the `src/lib/hooks/*` seam only. `fireEvent`, not `userEvent`:
 * this package has no `@testing-library/user-event` (client/INSIGHTS.md).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefRecord, ReviewRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import brief from "../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";
import blast from "../../../../../../../../messages/en/blast.json";

const mutate = vi.fn();
let briefQuery: { data: PrBriefRecord | null | undefined; isLoading: boolean } = {
  data: null,
  isLoading: false,
};
let gen: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};
let reviews: ReviewRecord[] | undefined = undefined;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrBrief: () => briefQuery,
  useGeneratePrBrief: () => ({ mutate, ...gen }),
  usePrReviews: () => ({ data: reviews }),
}));

import { PrBriefCard } from "./PrBriefCard";

const onOpenInDiff = vi.fn();

afterEach(() => {
  cleanup();
  mutate.mockClear();
  onOpenInDiff.mockClear();
  briefQuery = { data: null, isLoading: false };
  gen = { isPending: false, isError: false, error: null };
  reviews = undefined;
});

function record(over: Partial<PrBriefRecord> = {}): PrBriefRecord {
  return {
    summary: "Adds per-token rate limiting so one client cannot exhaust the Redis pool.",
    intent: {
      intent: "Stop one API client from exhausting the shared Redis pool.",
      in_scope: ["Public endpoints"],
      out_of_scope: ["Internal endpoints"],
    },
    blast: null,
    risks: {
      risks: [
        {
          kind: "security",
          title: "Limiter key read from env",
          explanation: "A missing key silently disables limiting.",
          severity: "high",
          file_refs: ["src/config.ts:12-14", "src/api/public/items.ts:23"],
        },
        {
          kind: "tests",
          title: "No test for the 429 path",
          explanation: "The rejection branch is uncovered.",
          severity: "low",
          file_refs: ["src/api/rate-limit.ts"],
        },
      ],
    },
    review_focus: [
      { file: "src/config.ts", line: 12, reason: "Where the key is read." },
      { file: "src/api/rate-limit.ts", line: 41, reason: "The exported limiter." },
    ],
    history: { history: [] },
    pr_id: "pr-1",
    head_sha: "a1b2c3d4",
    generated_at: "2026-09-30T12:00:00.000Z",
    provider: "openai",
    model: "gpt-4.1",
    attempts: 1,
    tokens_in: 4200,
    tokens_out: 600,
    cost_usd: 0.014,
    input_tokens_measured: 4100,
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
    ...over,
  };
}

const REVIEW: ReviewRecord = {
  id: "r1",
  pr_id: "pr-1",
  agent_id: null,
  run_id: null,
  agent_name: null,
  kind: "review",
  verdict: "request_changes",
  summary: "Review summary",
  score: 64,
  model: "test/model",
  grounding: null,
  created_at: "2026-09-30T11:00:00Z",
  findings: [],
};

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview, blast }}>
      <PrBriefCard prId="pr-1" repoFullName="acme/api" headSha="a1b2c3d4" onOpenInDiff={onOpenInDiff} />
    </NextIntlClientProvider>,
  );
}

describe("PrBriefCard", () => {
  it("loading shows a placeholder, never the paid Generate action", () => {
    briefQuery = { data: undefined, isLoading: true };
    renderCard();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
  });

  it("with no brief, shows the empty card and generates only on click", () => {
    renderCard();
    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    expect(screen.getByText("Generate a Why+Risk brief for this PR.")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("while a first brief generates, shows the generating placeholder instead of the CTA", () => {
    gen = { isPending: true, isError: false, error: null };
    renderCard();
    expect(screen.getByRole("status", { name: "Generating brief…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
  });

  it("renders a ready brief, deep-links from focus items and risk refs, and expands a risk", () => {
    briefQuery = { data: record(), isLoading: false };
    reviews = [REVIEW];
    renderCard();

    // Banner: the brief's summary with the latest review's verdict and score.
    expect(screen.getByText(record().summary)).toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
    // The brief's own generation cost and tokens (not the review's).
    expect(screen.getByText("$0.014 · 4.2K→0.6K")).toBeInTheDocument();
    // All inputs present → no "Generated without" line.
    expect(screen.queryByText(/Generated without/)).not.toBeInTheDocument();

    // Intent snapshot.
    expect(screen.getByText(/Stop one API client/)).toBeInTheDocument();

    // Risk areas: one chip per risk, first ref shown, explanation collapsed.
    const risks = screen.getByRole("region", { name: "Risk areas" });
    expect(within(risks).getByText("Limiter key read from env")).toBeInTheDocument();
    expect(within(risks).getByText("No test for the 429 path")).toBeInTheDocument();
    expect(within(risks).getByText("src/config.ts:12-14")).toBeInTheDocument();
    expect(screen.queryByText("A missing key silently disables limiting.")).not.toBeInTheDocument();

    const header = screen.getByRole("button", { name: "High: Limiter key read from env" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A missing key silently disables limiting.")).toBeInTheDocument();
    // Expanded: every ref is a deep link, a range opening at its start line.
    fireEvent.click(screen.getByRole("button", { name: "src/api/public/items.ts:23" }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/api/public/items.ts", 23);
    fireEvent.click(screen.getByRole("button", { name: "src/config.ts:12-14" }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/config.ts", 12);

    // Review focus: heading, count, one button per item.
    const focus = screen.getByRole("region", { name: "Review focus — read these first" });
    expect(within(focus).getByText("2")).toBeInTheDocument();
    fireEvent.click(within(focus).getByRole("button", { name: /src\/config\.ts:12/ }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/config.ts", 12);
    fireEvent.click(within(focus).getByRole("button", { name: /src\/api\/rate-limit\.ts:41/ }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/api/rate-limit.ts", 41);

    // Regenerate is explicit.
    fireEvent.click(screen.getByRole("button", { name: "Regenerate brief" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("renders the stored blast snapshot in its own panel, and no panel when it was missing", () => {
    briefQuery = {
      data: record({
        blast: {
          changed_symbols: [{ name: "rateLimitSnapshotSym", file: "src/api/rate-limit.ts", kind: "function" }],
          downstream: [
            {
              symbol: "rateLimitSnapshotSym",
              callers: [{ name: "listItems", file: "src/api/public/items.ts", line: 23 }],
              endpoints_affected: [],
              crons_affected: [],
            },
          ],
          summary: "1 changed symbol reaches 1 caller",
        },
      }),
      isLoading: false,
    };
    renderCard();
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "rateLimitSnapshotSym" })).toBeInTheDocument();
    cleanup();

    briefQuery = { data: record({ blast: null }), isLoading: false };
    renderCard();
    expect(screen.queryByText("Blast radius")).not.toBeInTheDocument();
  });

  it("marks a stale brief, names missing inputs, and shows no score without a review", () => {
    briefQuery = {
      data: record({
        is_stale: true,
        intent: null,
        inputs: {
          intent: "missing",
          blast: "missing",
          description: "present",
          linked_issue: "present",
          project_context: "present",
        },
      }),
      isLoading: false,
    };
    renderCard();

    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("Generated without: Intent, Blast radius")).toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
    // The summary still leads.
    expect(screen.getByText(record().summary)).toBeInTheDocument();
  });

  it("keeps the previous brief visible under a failed regenerate, and retries on click", () => {
    briefQuery = { data: record(), isLoading: false };
    gen = { isPending: false, isError: true, error: new Error("provider down") };
    renderCard();

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't generate the brief.");
    expect(screen.getByText(record().summary)).toBeInTheDocument();
    expect(screen.getByText("Limiter key read from env")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("says a brief is already generating on a 409, rather than a generic failure", () => {
    briefQuery = { data: record(), isLoading: false };
    gen = { isPending: false, isError: true, error: new ApiError("busy", 409) };
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A brief is already being generated for this PR.",
    );
    expect(screen.queryByText("Couldn't generate the brief.")).not.toBeInTheDocument();
  });

  it("while regenerating over a prior brief, keeps it on screen with a busy refresh button", () => {
    briefQuery = { data: record(), isLoading: false };
    gen = { isPending: true, isError: false, error: null };
    renderCard();
    expect(screen.getByText(record().summary)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generating brief…" })).toBeInTheDocument();
  });

  it("renders model text literally — markup in a summary is never interpreted", () => {
    const summary = "Adds limits <b>x</b> <img src=x onerror=alert(1)>";
    briefQuery = { data: record({ summary }), isLoading: false };
    renderCard();
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});
