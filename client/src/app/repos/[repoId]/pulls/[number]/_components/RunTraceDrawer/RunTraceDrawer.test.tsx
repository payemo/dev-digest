import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// Each test may swap in its own trace; reset after every test.
let currentTrace: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: currentTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.060")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

/** Literal `## Project context` slot text, exactly as the engine records it. */
const SPECS_SLOT =
  '<untrusted source="spec-0">\n.devdigest/specs/api.md\n\n# API\nVersion every route.\n</untrusted>\n\n' +
  '<untrusted source="spec-1">\n.devdigest/docs/errors.md\n\n# Errors\nUse RFC 7807.\n</untrusted>';

/** A trace with every prompt slot populated, as a project-context run would record it. */
const FULL_TRACE: RunTrace = {
  ...TRACE,
  prompt_assembly: {
    system: "You are a reviewer.",
    pr_description: '<untrusted source="pr-description">\nAdds rate limiting.\n</untrusted>',
    intent: "## Derived intent (confidence: low)",
    skills: "### skill",
    memory: "- remember this",
    repo_map: "src/a.ts: fn a()",
    specs: SPECS_SLOT,
    callers: "src/b.ts calls a()",
    user: "Review PR #482",
  },
  specs_read: [".devdigest/specs/api.md", ".devdigest/docs/errors.md", ".devdigest/specs/gone.md"],
  specs_read_detail: [
    { path: ".devdigest/specs/api.md", origin: "repo", status: "injected" },
    { path: ".devdigest/docs/errors.md", origin: "user", status: "injected" },
    { path: ".devdigest/specs/gone.md", origin: "repo", status: "missing" },
  ],
};

function renderDrawer() {
  return renderWithIntl(
    <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />,
  );
}

/** True when `a` renders before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("Run Trace drawer — project context", () => {
  it("lists the documents read, marking a skipped one, and shows the literal project-context slot", () => {
    currentTrace = FULL_TRACE;
    renderDrawer();

    expect(screen.getByText("Documents read")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/specs/api.md")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/docs/errors.md")).toBeInTheDocument();
    expect(screen.getByText(".devdigest/specs/gone.md")).toBeInTheDocument();
    // Only the missing document carries the skipped marker.
    expect(screen.getAllByText(/skipped/)).toHaveLength(1);
    expect(screen.getByText(/repo · skipped/)).toBeInTheDocument();

    // Open the Prompt assembly section, then expand the project-context block.
    fireEvent.click(screen.getByText("Prompt assembly"));
    fireEvent.click(screen.getByText("Project context (dynamic)"));
    // Match on the raw textContent so newlines are not collapsed away.
    const slot = screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === SPECS_SLOT);
    expect(slot).toBeInTheDocument();
  });

  it("falls back to the plain specs_read list for a trace persisted before the detail field existed", () => {
    currentTrace = { ...TRACE, specs_read: [".devdigest/specs/legacy.md"] };
    renderDrawer();

    expect(screen.getByText(".devdigest/specs/legacy.md")).toBeInTheDocument();
    expect(screen.queryByText(/skipped/)).not.toBeInTheDocument();
  });

  it("shows 'none' when a run read no documents", () => {
    currentTrace = { ...TRACE, specs_read: [], specs_read_detail: [] };
    renderDrawer();

    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("renders the prompt slots in the engine's real assembly order, including PR description and intent", () => {
    currentTrace = FULL_TRACE;
    renderDrawer();
    fireEvent.click(screen.getByText("Prompt assembly"));

    const order = [
      "System",
      "PR description (dynamic)",
      "Derived intent (dynamic)",
      "Skills (dynamic)",
      "Memory (dynamic)",
      "Repo skeleton — repo-intel (dynamic)",
      "Project context (dynamic)",
      "Callers of changed symbols — repo-intel (dynamic)",
      "User / diff (dynamic)",
    ].map((label) => screen.getByText(label));

    for (let i = 0; i < order.length - 1; i++) {
      expect(precedes(order[i]!, order[i + 1]!), `${order[i]!.textContent} before ${order[i + 1]!.textContent}`).toBe(true);
    }
  });
});
