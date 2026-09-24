/**
 * IntentCard — the five states this card can be in (L03, plan Step 13).
 *
 * Deriving costs a model call, so which state the user is shown is the whole
 * behaviour: a loading PR must NOT render the empty state's paid "Derive
 * intent" call to action, a stale record must say so, and a low-confidence
 * record must read as weak rather than as a specification.
 *
 * Mocked at the `src/lib/hooks/*` seam (never inside the component, never at
 * `fetch` from here) — the same seam the conventions page tests use.
 *
 * Risk chips are queried with `getByText`: they are `<span>`-based `Badge`s on
 * purpose, and `getByRole("button")` would encode the opposite contract (see
 * client/INSIGHTS.md — Badge is a span, Chip is a button).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: this package has no `@testing-library/user-event`
// dependency, and adding one is not this change's business.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutate = vi.fn();
let query: { data: PrIntentRecord | null | undefined; isLoading: boolean } = {
  data: null,
  isLoading: false,
};
let derivePending = false;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => query,
  useDerivePrIntent: () => ({ mutate, isPending: derivePending }),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  mutate.mockClear();
  query = { data: null, isLoading: false };
  derivePending = false;
});

function record(over: Partial<PrIntentRecord> = {}): PrIntentRecord {
  return {
    pr_id: "pr-1",
    intent: "Stop one API client from exhausting the shared Redis pool.",
    in_scope: ["Per-token limits on public endpoints"],
    out_of_scope: ["Authenticated internal endpoints"],
    confidence: 0.8,
    risk_areas: [
      { label: "Secret handling", evidence_path: "src/config.ts" },
      { label: "New dependency", evidence_path: "server/package.json" },
    ],
    sources: ["spec:docs/plans/lab03.plan.md", "issue:471", "body", "paths"],
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    derived_at: "2026-09-24T12:00:00.000Z",
    head_sha: "a1b2c3d4",
    is_stale: false,
    tokens_in: 900,
    tokens_out: 120,
    cost_usd: 0.0003,
    ...over,
  };
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <IntentCard prId="pr-1" />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("shows a placeholder while loading — never the paid Derive action", () => {
    query = { data: undefined, isLoading: true };
    renderCard();

    expect(screen.getByText("Intent")).toBeInTheDocument();
    // The regression that matters: falling through to the empty state would
    // offer a paid derivation for a PR whose record may already exist.
    expect(screen.queryByText("No intent derived yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // `Skeleton` renders no accessible role, so its class is the only observable
    // marker that a placeholder (rather than a blank card) is on screen.
    expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("offers Derive intent when nothing has been derived, and firing it shows progress", () => {
    renderCard();

    expect(screen.getByText("No intent derived yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Derive intent/ }));
    expect(mutate).toHaveBeenCalledTimes(1);

    cleanup();
    derivePending = true;
    renderCard();
    expect(screen.getByRole("button", { name: /Deriving/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Derive intent$/ })).not.toBeInTheDocument();
  });

  it("renders a derived record: sentence, both scope lists, risk chips, confidence and usage", () => {
    query = { data: record(), isLoading: false };
    renderCard();

    expect(screen.getByText(/Stop one API client from exhausting/)).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("Per-token limits on public endpoints")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("Authenticated internal endpoints")).toBeInTheDocument();

    // Read-only labels: present as text, NOT announced as controls.
    expect(screen.getByText("Secret handling")).toBeInTheDocument();
    expect(screen.getByText("New dependency")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Secret handling" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New dependency" })).not.toBeInTheDocument();

    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText("80% conf")).toBeInTheDocument();
    expect(screen.getByText("Based on: spec, issue, body, paths")).toBeInTheDocument();
    expect(screen.getByText("1020 tok · $0.0003")).toBeInTheDocument();

    // A confident record carries no weakness hint and no staleness warning.
    expect(screen.queryByText(/Derived from indirect signals only/)).not.toBeInTheDocument();
    expect(screen.queryByText("May be out of date")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Re-derive/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("marks a low-confidence record as low and explains why", () => {
    query = {
      data: record({ confidence: 0.2, sources: ["commits", "branch", "paths"] }),
      isLoading: false,
    };
    renderCard();

    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Derived from indirect signals only — no linked issue, spec, or written description.",
      ),
    ).toBeInTheDocument();
  });

  it("warns that a stale record may be out of date, and still lets the user re-derive", () => {
    query = { data: record({ is_stale: true, head_sha: "olddead" }), isLoading: false };
    renderCard();

    expect(screen.getByText("May be out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-derive/ })).toBeInTheDocument();
    // The stale record's own content is still shown — a stale intent beats none.
    expect(screen.getByText(/Stop one API client from exhausting/)).toBeInTheDocument();
  });
});
