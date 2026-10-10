import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";
import { makeCompare } from "@/test/eval-fixtures";

const hooks = vi.hoisted(() => ({ compare: vi.fn(), promote: vi.fn() }));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: hooks.compare,
  usePromoteVersion: () => ({ mutate: hooks.promote, isPending: false, error: null }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(() => {
  cleanup();
  hooks.compare.mockReset();
  hooks.promote.mockReset();
});

function renderCompare(data: ReturnType<typeof makeCompare>) {
  hooks.compare.mockReturnValue({ data, isError: false });
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <CompareRunsModal agentId="agent-1" a="run-v7" b="run-v6" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("CompareRunsModal", () => {
  it("AC-60/AC-61/AC-68: older → newer title, marked prompt lines, Promote unavailable when active", () => {
    renderCompare(makeCompare({ promote: { version: 7, available: false, skill_mismatch: false } }));

    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();
    expect(screen.getByText("+10pt")).toBeInTheDocument(); // recall 0.7 → 0.8
    expect(screen.getByText("- Flag secrets.")).toBeInTheDocument();
    expect(screen.getByText("+ Flag secrets and SSRF.")).toBeInTheDocument();
    expect(screen.getByText("You are a reviewer.")).toBeInTheDocument(); // unchanged line is context

    expect(screen.getByRole("button", { name: "Promote v7" })).toBeDisabled();
    expect(screen.getByText("v7 is already the active version")).toBeInTheDocument();
  });

  it("AC-62/AC-65: same prompt and config differences are listed", () => {
    renderCompare(
      makeCompare({
        same_prompt: true,
        new_prompt: "You are a reviewer.\nFlag secrets.",
        skill_diff: { added: ["Grounded citations only"], removed: [], reordered: false, changed: [] },
        case_set: { same: false, only_old: 1, only_new: 2 },
      }),
    );
    expect(screen.getByText("same prompt")).toBeInTheDocument();
    expect(screen.getByText("Skills added: Grounded citations only")).toBeInTheDocument();
    expect(
      screen.getByText("Different case sets: 1 only in the older run, 2 only in the newer"),
    ).toBeInTheDocument();
  });

  it("AC-69: a skill mismatch is shown before Promote is confirmed", () => {
    renderCompare(makeCompare({ promote: { version: 7, available: true, skill_mismatch: true } }));

    expect(screen.queryByText(/used different skills/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Promote v7" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This run used different skills than are linked now.");
    expect(hooks.promote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    expect(hooks.promote).toHaveBeenCalledWith({ agentId: "agent-1", runId: "run-v7" }, expect.anything());
  });
});
