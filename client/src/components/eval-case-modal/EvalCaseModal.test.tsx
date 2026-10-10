import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/eval.json";
import { makeCase, makeResult, POSITIVE_DRAFT, STRIPE_DIFF } from "@/test/eval-fixtures";

// Server access goes through these hooks only — mocked at that seam.
const hooks = vi.hoisted(() => ({
  seed: vi.fn(),
  createFromFinding: vi.fn(),
  createCase: vi.fn(),
  updateCase: vi.fn(),
  runCase: vi.fn(),
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseSeed: hooks.seed,
  useCreateCaseFromFinding: () => ({ mutateAsync: hooks.createFromFinding, isPending: false, error: null }),
  useCreateEvalCase: () => ({ mutateAsync: hooks.createCase, isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: hooks.updateCase, isPending: false, error: null }),
  useRunEvalCase: () => ({ mutateAsync: hooks.runCase, isPending: false, error: null }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

beforeEach(() => {
  Object.values(hooks).forEach((h) => h.mockReset());
});
afterEach(cleanup);

function renderModal(mode: Parameters<typeof EvalCaseModal>[0]["mode"]) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseModal mode={mode} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

const save = () => screen.getByRole("button", { name: "Save" });
const textareas = () => Array.from(document.querySelectorAll("textarea"));
/** The expected-output JSON editor is the right-hand (last) textarea. */
const expectedField = () => textareas()[textareas().length - 1]!;

describe("EvalCaseModal — seeded from a finding", () => {
  it("AC-4/AC-5/AC-10/AC-24: a positive seed shows its banner and saves with no edits, then runs", async () => {
    hooks.seed.mockReturnValue({
      data: { decision: "accepted", existing: null, draft: POSITIVE_DRAFT },
      isLoading: false,
      isError: false,
    });
    hooks.createFromFinding.mockResolvedValue(makeCase({ id: "new-case" }));
    hooks.runCase.mockResolvedValue(makeResult({ expected_n: 1, got_m: 1, duration_ms: 1800, cost_usd: 0.02 }));
    renderModal({ kind: "fromFinding", findingId: "f1" });

    expect(screen.getByText(/Seeded from a accepted finding/)).toBeInTheDocument();
    expect(screen.getByText("POSITIVE CASE")).toBeInTheDocument();
    expect(
      screen.getByText('MUST find "Hardcoded Stripe secret key in commit" at src/config.ts:12'),
    ).toBeInTheDocument();
    // The frozen diff is shown read-only: there is no editable diff field.
    expect(screen.queryByPlaceholderText(/stripeKey/)).not.toBeInTheDocument();

    expect(save()).toBeEnabled();
    fireEvent.click(save());

    await waitFor(() => expect(hooks.runCase).toHaveBeenCalledWith("new-case"));
    expect(hooks.createFromFinding).toHaveBeenCalledWith({
      findingId: "f1",
      overrides: { name: POSITIVE_DRAFT.name, expected_output: POSITIVE_DRAFT.expected_output },
    });
    expect(
      await screen.findByText("Last run passed · expected 1 finding, got 1 · 1.8s · $0.02"),
    ).toBeInTheDocument();
  });

  it("AC-13: a negative seed shows the forbidden-location banner and asserts an empty list", () => {
    hooks.seed.mockReturnValue({
      data: {
        decision: "dismissed",
        existing: null,
        draft: {
          ...POSITIVE_DRAFT,
          name: "no-unused-lodash-import",
          kind: "must_not_flag",
          expected_output: [],
          forbidden_location: { file: "src/api/users.ts", start_line: 2, end_line: 2 },
        },
      },
      isLoading: false,
      isError: false,
    });
    renderModal({ kind: "fromFinding", findingId: "f2", findingTitle: "Unused lodash import" });

    expect(screen.getByText(/Seeded from a dismissed finding/)).toBeInTheDocument();
    expect(screen.getByText("NEGATIVE CASE")).toBeInTheDocument();
    expect(screen.getByText("MUST NOT comment on src/api/users.ts:2 (Unused lodash import)")).toBeInTheDocument();
    expect(screen.getByText("assert empty")).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it("AC-19: a refused seed shows the server's message and offers no Save", () => {
    hooks.seed.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("No stored diff for src/x.ts — this finding can't be frozen into a case."),
    });
    renderModal({ kind: "fromFinding", findingId: "f3" });
    expect(screen.getByRole("alert")).toHaveTextContent("No stored diff for src/x.ts");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});

describe("EvalCaseModal — hand-made case", () => {
  it("AC-20–AC-23: Save is gated on name, JSON validity and the kind rule; skeleton fills five keys", () => {
    renderModal({ kind: "new", agentId: "agent-1" });

    // Empty name → refused.
    expect(save()).toBeDisabled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "stripe-key-leak" } });
    fireEvent.change(screen.getByPlaceholderText(/stripeKey/), { target: { value: STRIPE_DIFF } });
    // must_find with [] breaks the kind rule.
    expect(expectedField().value).toBe("[]");
    expect(save()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Finding skeleton" }));
    const list = JSON.parse(expectedField().value) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual(["category", "file", "severity", "start_line", "title"]);
    expect(list[0]!.file).toBe("src/config.ts"); // taken from the diff
    expect(save()).toBeEnabled();

    fireEvent.change(expectedField(), { target: { value: "[{" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    // must_not_flag refuses a non-empty expected list …
    fireEvent.change(expectedField(), {
      target: { value: JSON.stringify([{ severity: "WARNING", category: "bug", title: "t", file: "a.ts", start_line: 1 }]) },
    });
    fireEvent.click(screen.getByRole("radio", { name: "MUST NOT FLAG" }));
    expect(screen.getByText(/must_not_flag needs \[\]/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
    // … and accepts [] as "assert empty".
    fireEvent.change(expectedField(), { target: { value: "[]" } });
    expect(screen.getByText("assert empty")).toBeInTheDocument();
    expect(save()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(screen.getByText("Reference only — file contents are not sent to the agent")).toBeInTheDocument();
  });

  it("AC-24/AC-26: with Run on save, a must_not_flag case saves, runs and reports expected 0, got M", async () => {
    hooks.createCase.mockResolvedValue(makeCase({ id: "hm-1", kind: "must_not_flag", expected_output: [] }));
    hooks.runCase.mockResolvedValue(
      makeResult({ case_kind: "must_not_flag", status: "failed", expected_n: 0, got_m: 2, duration_ms: 1200, cost_usd: null }),
    );
    renderModal({ kind: "new", agentId: "agent-1" });

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "no-noise" } });
    fireEvent.change(screen.getByPlaceholderText(/stripeKey/), { target: { value: STRIPE_DIFF } });
    fireEvent.click(screen.getByRole("radio", { name: "MUST NOT FLAG" }));
    fireEvent.click(save());

    await waitFor(() => expect(hooks.runCase).toHaveBeenCalledWith("hm-1"));
    expect(hooks.createCase).toHaveBeenCalledWith(
      expect.objectContaining({ name: "no-noise", kind: "must_not_flag", expected_output: [], forbidden_location: null }),
    );
    expect(await screen.findByText("Last run failed · expected 0 findings, got 2 · 1.2s · —")).toBeInTheDocument();
  });
});
