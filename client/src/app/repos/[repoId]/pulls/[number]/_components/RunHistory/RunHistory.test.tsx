/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, Severity, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function finding(severity: Severity, o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: `f-${severity}-${o.title ?? ""}`,
    severity,
    category: "security",
    title: `${severity} finding`,
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
    ...o,
  };
}

function renderRuns(runs: RunSummary[], findingsByRun?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — findings by severity", () => {
  it("breaks the findings total down per severity, skipping the empty ones", () => {
    renderRuns(
      [run({ status: "done", findings_count: 3, blockers: 2, score: 38 })],
      new Map([
        [
          "run-1",
          [
            finding("CRITICAL", { id: "f1" }),
            finding("CRITICAL", { id: "f2" }),
            finding("SUGGESTION", { id: "f3" }),
          ],
        ],
      ]),
    );
    // icon + count per severity, worst first — not a bare "3 finding(s)" total
    expect(screen.queryByText(/3 finding/)).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // CRITICAL
    expect(screen.getByText("1")).toBeInTheDocument(); // SUGGESTION
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("falls back to the run's own total when no findings are available", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText(/3 finding/)).toBeInTheDocument();
  });

  it("previews the findings on hover, read-only — no accept/reject actions", async () => {
    const { container } = renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 1, score: 38 })],
      new Map([["run-1", [finding("CRITICAL", { id: "f1", title: "Hardcoded Stripe key" })]]]),
    );
    expect(screen.queryByText("Hardcoded Stripe key")).not.toBeInTheDocument();

    fireEvent.mouseEnter(container.querySelector("[data-findings-summary]")!);
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe key")).toBeInTheDocument();
    expect(screen.getByText(/findings in this run/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept|reject/i })).not.toBeInTheDocument();
  });
});

describe("RunHistory — usage (tokens + cost)", () => {
  it("shows grouped tokens and formatted cost for a settled run", () => {
    renderRuns([
      run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013, findings_count: 0, blockers: 0, score: 95 }),
    ]);
    expect(screen.getByText(/9,119 tok/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0013/)).toBeInTheDocument();
  });

  it("shows a dash for cost when the model isn't priced, without hiding the token count", () => {
    renderRuns([
      run({ status: "done", tokens_in: 5000, tokens_out: 500, cost_usd: null, findings_count: 0, blockers: 0, score: 80 }),
    ]);
    expect(screen.getByText(/5,500 tok/)).toBeInTheDocument();
    expect(screen.getByText(/—/)).toBeInTheDocument();
  });
});
