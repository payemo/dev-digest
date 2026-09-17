/**
 * PRRow — the FINDINGS column summarises ALL of the PR's findings (across
 * every review run, not just the latest) by severity, and reveals a READ-ONLY
 * preview on hover (accept/reject live on the PR page, not here).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, Finding } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PRRow } from "./PRRow";

afterEach(cleanup);

const FINDING: Finding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A live secret key is committed.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
};

function pr(o: Partial<PrMeta> = {}): PrMeta {
  return {
    id: "pr1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "a1b2c3d",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: 38,
    cost_usd: 0.0012,
    findings: [FINDING],
    ...o,
  };
}

function renderRow(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={meta} repoId="repo1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — findings column", () => {
  it("shows a severity count, and previews the PR's findings on hover", async () => {
    const { container } = renderRow(pr());
    expect(screen.queryByText("Hardcoded Stripe key")).not.toBeInTheDocument();

    fireEvent.mouseEnter(container.querySelector("[data-findings-summary]")!);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText(/1 findings in this run/i)).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe key")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    // read-only: the preview never offers accept/reject
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sums findings across every review run, not just the latest one", async () => {
    // `findings` is server-aggregated across ALL of the PR's reviews (see
    // pulls/routes.ts) — the row just renders whatever it's given, so this
    // proves it doesn't silently drop anything down to "the latest run".
    const olderRunFinding: Finding = { ...FINDING, id: "f2", severity: "WARNING", title: "N+1 query" };
    const { container } = renderRow(pr({ findings: [FINDING, olderRunFinding] }));

    fireEvent.mouseEnter(container.querySelector("[data-findings-summary]")!);
    expect(await screen.findByText(/2 findings in this run/i)).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe key")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("falls back to a dash when the PR has no findings", () => {
    const { container } = renderRow(pr({ findings: [] }));
    expect(container.querySelector("[data-findings-summary]")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
