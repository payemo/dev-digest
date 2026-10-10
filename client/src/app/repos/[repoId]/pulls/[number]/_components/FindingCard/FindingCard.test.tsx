import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { POSITIVE_DRAFT } from "@/test/eval-fixtures";

// The eval-case modal the card opens talks to the server only through these
// hooks — the one seam this test mocks.
const seedHook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCaseSeed: seedHook,
  useCreateCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useRunEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/reject actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    // label is "Reject"; the persisted action stays `dismiss`
    fireEvent.click(screen.getByText("Reject"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  describe("Turn into eval case (AC-1 – AC-3)", () => {
    const turnInto = () => screen.getByRole("button", { name: "Turn into eval case" });

    it("is enabled on an accepted finding and opens the seeded case modal", () => {
      seedHook.mockReturnValue({
        data: { decision: "accepted", existing: null, draft: POSITIVE_DRAFT },
        isLoading: false,
        isError: false,
      });
      renderWithIntl(
        <FindingCard f={{ ...FINDING, accepted_at: "2026-09-01T00:00:00Z" }} defaultExpanded onAction={() => {}} />,
      );
      expect(turnInto()).toBeEnabled();
      expect(screen.queryByText("Accept or dismiss this finding first")).not.toBeInTheDocument();

      fireEvent.click(turnInto());
      expect(seedHook).toHaveBeenCalledWith("f1");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/Seeded from a accepted finding/)).toBeInTheDocument();
    });

    it("is enabled on a dismissed finding", () => {
      renderWithIntl(
        <FindingCard f={{ ...FINDING, dismissed_at: "2026-09-01T00:00:00Z" }} defaultExpanded onAction={() => {}} />,
      );
      expect(turnInto()).toBeEnabled();
    });

    it("is disabled with a visible hint while the finding is undecided", () => {
      renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
      expect(turnInto()).toBeDisabled();
      expect(screen.getByText("Accept or dismiss this finding first")).toBeInTheDocument();
      fireEvent.click(turnInto());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
