import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

const mutate = vi.fn();
vi.mock("@/lib/hooks/conventions", () => ({
  useUpdateConvention: () => ({ mutate, isPending: false }),
}));

import { ConventionCard } from "./ConventionCard";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function candidate(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    repo_id: "r1",
    category: "errors",
    rule: "Use async/await instead of .then() chains.",
    rationale: null,
    evidence_path: "src/api/users.ts",
    evidence_line: 23,
    evidence_snippet: "const user = await db.users.find(id);",
    confidence: 0.85,
    status: "pending",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function renderCard(overrides: Partial<ConventionCandidate> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        repoId="repo-1"
        repoFullName="acme/app"
        defaultBranch="main"
        candidate={candidate(overrides)}
      />
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders the rule, evidence file:line, excerpt, and confidence", () => {
    renderCard();
    expect(screen.getByText("Use async/await instead of .then() chains.")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23")).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("links evidence to GitHub at the exact line", () => {
    renderCard();
    const link = screen.getByText("src/api/users.ts:23").closest("a");
    expect(link).toHaveAttribute("href", "https://github.com/acme/app/blob/main/src/api/users.ts#L23");
  });

  it("Accept sends a PATCH with status approved", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "repo-1", id: "c1", patch: { status: "approved" } }),
    );
  });

  it("clicking Accept again on an already-approved candidate reverts to pending", () => {
    renderCard({ status: "approved" });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { status: "pending" } }),
    );
  });

  it("Reject sends a PATCH with status rejected", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: "repo-1", id: "c1", patch: { status: "rejected" } }),
    );
  });

  it("Edit swaps the rule into an inline input, without navigating or opening a modal", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText("Describe the convention…") as HTMLInputElement;
    expect(input.value).toBe("Use async/await instead of .then() chains.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Save persists the edited rule via PATCH", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText("Describe the convention…");
    fireEvent.change(input, { target: { value: "Prefer async/await for DB calls." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "c1",
        patch: { rule: "Prefer async/await for DB calls.", category: "errors" },
      }),
      expect.anything(),
    );
  });

  it("Cancel discards the edit without persisting", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByPlaceholderText("Describe the convention…");
    fireEvent.change(input, { target: { value: "Something else entirely." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Use async/await instead of .then() chains.")).toBeInTheDocument();
  });
});
