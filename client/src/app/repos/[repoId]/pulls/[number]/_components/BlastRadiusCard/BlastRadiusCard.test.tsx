/**
 * BlastRadiusCard — the states this card can be in (L04, plan Step 12).
 *
 * Mocked at the `src/lib/hooks/*` seam (never inside the component, never at
 * `fetch` from here) — the same seam IntentCard's test uses. Because the
 * network is mocked, this suite CANNOT catch a real response-shape change:
 * that is the server integration test's job.
 *
 * Two query choices are deliberate contracts, not conveniences:
 *   - per-symbol rows are found as `role="region"`, never as a positional slice
 *     of `getAllByRole("button")` — the diff viewer's FileCard headers are also
 *     role="button" + aria-expanded, so a button query encodes nothing,
 *   - endpoint/cron chips are found by TEXT, because they are `<span>`-based
 *     `Badge`s; asserting them as buttons would encode the opposite contract.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
// `fireEvent`, not `userEvent`: this package has no `@testing-library/user-event`
// dependency, and adding one would touch the lockfile.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/blast.json";
import type { PrBlastRadius } from "@/lib/hooks/reviews";

const mutate = vi.fn();
let query: { data: PrBlastRadius | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
let resyncPending = false;

vi.mock("@/lib/hooks/reviews", () => ({
  usePrBlastRadius: () => query,
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate, isPending: resyncPending }),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(() => {
  cleanup();
  mutate.mockClear();
  query = { data: undefined, isLoading: false, isError: false };
  resyncPending = false;
});

const DECL = "src/api/rate-limit.ts";

function data(over: Partial<PrBlastRadius> = {}): PrBlastRadius {
  return {
    changed_symbols: [
      { name: "rateLimit", file: DECL, kind: "function" },
      { name: "resetBuckets", file: DECL, kind: "function" },
    ],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [
          { name: "listItems", file: "src/api/public/index.ts", line: 23 },
          { name: "flush", file: "src/api/admin/index.ts", line: 11 },
        ],
        endpoints_affected: ["GET /api/public/items"],
        crons_affected: [],
      },
      {
        symbol: "resetBuckets",
        callers: [{ name: "run", file: "src/jobs/hourly.ts", line: 8 }],
        endpoints_affected: [],
        crons_affected: ["reset-rate-buckets (hourly)"],
      },
    ],
    summary: "2 changed symbol(s), 3 caller(s) in 3 file(s), 1 endpoint(s), 1 cron(s).",
    ...over,
  };
}

function renderCard(repoFullName: string | null = "acme/payments-api") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusCard
        prId="pr-1"
        repoId="repo-1"
        repoFullName={repoFullName}
        headSha="a1b2c3d4"
      />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusCard", () => {
  it("shows placeholders while loading, and none of the stats", () => {
    query = { data: undefined, isLoading: true, isError: false };
    renderCard();

    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("symbols")).not.toBeInTheDocument();
    expect(screen.queryByText("callers")).not.toBeInTheDocument();
  });

  it("renders the stat row, one region per symbol, only the first one expanded", () => {
    query = { data: data(), isLoading: false, isError: false };
    renderCard();

    for (const label of ["symbols", "callers", "endpoints", "cron/jobs"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // One landmark per changed symbol — not a slice of the button list.
    const regions = screen.getAllByRole("region");
    expect(regions.map((r) => r.getAttribute("aria-label"))).toEqual([
      "rateLimit",
      "resetBuckets",
    ]);

    const headers = screen.getAllByRole("button", { expanded: false });
    expect(headers).toHaveLength(1);
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);

    // The open row shows its callers as BLOB links at the head sha — a caller
    // file is not in the diff, so a diff link would point at nothing.
    const link = screen.getByRole("link", { name: "src/api/public/index.ts:23" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/a1b2c3d4/src/api/public/index.ts#L23",
    );
    expect(link.getAttribute("href")).toContain("/blob/");
    expect(link.getAttribute("href")).toContain("#L");
    // Both changed symbols are declared in the same file, so both rows say so.
    expect(screen.getAllByText("declared in src/api/rate-limit.ts")).toHaveLength(2);
    expect(screen.getByText("2 callers")).toBeInTheDocument();

    // The endpoint chip of the open row; the collapsed row's cron chip is not
    // rendered yet.
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.queryByText("reset-rate-buckets (hourly)")).not.toBeInTheDocument();
    // Read-only labels, not controls.
    expect(
      screen.queryByRole("button", { name: "GET /api/public/items" }),
    ).not.toBeInTheDocument();

    // Expanding the second row reveals its cron chip.
    fireEvent.click(headers[0]!);
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/jobs/hourly.ts:8" })).toBeInTheDocument();
  });

  it("degrades a caller reference to plain text when there is no repo slug", () => {
    query = { data: data(), isLoading: false, isError: false };
    renderCard(null);

    // Not a MonoLink without href — that renders a <button>, i.e. a dead control.
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "src/api/public/index.ts:23" }),
    ).not.toBeInTheDocument();
  });

  it("says how many symbols found no callers instead of showing an empty box", () => {
    query = {
      data: data({
        downstream: [
          { symbol: "rateLimit", callers: [], endpoints_affected: [], crons_affected: [] },
          { symbol: "resetBuckets", callers: [], endpoints_affected: [], crons_affected: [] },
        ],
      }),
      isLoading: false,
      isError: false,
    };
    renderCard();

    expect(
      screen.getByText("2 changed symbol(s), no downstream callers found."),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("names the degraded reason and offers a re-analyze that fires the mutation", () => {
    query = { data: data({ degraded: true, reason: "no_data" }), isLoading: false, isError: false };
    renderCard();

    expect(screen.getByText(/Index incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Not indexed yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Re-analyze/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic label for a reason it has never seen", () => {
    query = {
      data: data({ degraded: true, reason: "quantum_flux" }),
      isLoading: false,
      isError: false,
    };
    renderCard();

    // `reason` crosses the wire as an open string so a new server-side reason
    // cannot 500 the endpoint; the cost is handled here, not with a blank badge.
    expect(screen.getByText(/Index unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/quantum_flux/)).not.toBeInTheDocument();
  });

  it("renders the empty state when the PR declares no symbols the index knows", () => {
    query = {
      data: data({ changed_symbols: [], downstream: [] }),
      isLoading: false,
      isError: false,
    };
    renderCard();

    expect(screen.getByText("Nothing the index can reach")).toBeInTheDocument();
    expect(screen.queryByText("symbols")).not.toBeInTheDocument();
  });

  it("switches to the graph view, and says so when there is nothing to draw", () => {
    query = { data: data(), isLoading: false, isError: false };
    renderCard();

    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.getByText("changed symbol")).toBeInTheDocument();
    expect(screen.getByText("endpoint")).toBeInTheDocument();

    cleanup();
    query = {
      data: data({
        downstream: [
          { symbol: "rateLimit", callers: [], endpoints_affected: [], crons_affected: [] },
        ],
      }),
      isLoading: false,
      isError: false,
    };
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
  });

  it("reports a failed query without pretending the radius is empty", () => {
    query = { data: undefined, isLoading: false, isError: true };
    renderCard();

    expect(screen.getByText("Could not load the blast radius")).toBeInTheDocument();
    expect(screen.queryByText("symbols")).not.toBeInTheDocument();
  });
});
