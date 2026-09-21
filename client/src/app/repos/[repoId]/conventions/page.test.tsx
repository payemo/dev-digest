import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";
import { ToastProvider } from "@/lib/toast";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1" }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>repo not found</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app", default_branch: "main" } }),
  useRepoNotFound: () => false,
}));

const extractMutate = vi.fn();
let extractPending = false;
let conventionsData: ConventionCandidate[] | undefined = [];
let conventionsLoading = false;
let conventionsError = false;

vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: conventionsData,
    isLoading: conventionsLoading,
    isError: conventionsError,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: extractPending }),
  useUpdateConvention: () => ({ mutate: vi.fn(), isPending: false }),
  useConventionSkillDraft: () => ({ data: undefined, isLoading: true, isError: false, error: undefined }),
  useCreateConventionsSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

import ConventionsPage from "./page";

afterEach(() => {
  cleanup();
  extractMutate.mockClear();
  extractPending = false;
  conventionsData = [];
  conventionsLoading = false;
  conventionsError = false;
});

function candidate(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    repo_id: "repo-1",
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

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <ConventionsPage />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ConventionsPage", () => {
  it("shows Run Scan on first use (no candidates yet, never scanned)", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Run Scan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-scan" })).not.toBeInTheDocument();
  });

  it("shows a loading skeleton while candidates are loading", () => {
    conventionsLoading = true;
    renderPage();
    expect(screen.queryByRole("button", { name: "Run Scan" })).not.toBeInTheDocument();
  });

  it("shows a recoverable error state when the list fails to load", () => {
    conventionsError = true;
    renderPage();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("clicking Run Scan triggers the extract mutation, guarded against a double click", () => {
    const { rerender } = renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Run Scan" }));
    expect(extractMutate).toHaveBeenCalledTimes(1);

    // Simulate the mutation now being in flight (isPending: true) and re-render,
    // the same way React Query would flip it once the mutation starts.
    extractPending = true;
    rerender(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ToastProvider>
          <ConventionsPage />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    const button = screen.getByRole("button", { name: "Run Scan" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // still just the one call — a disabled button cannot fire a second scan
    expect(extractMutate).toHaveBeenCalledTimes(1);
  });

  it("renders result cards, filter chips with counts, and a Re-scan action once candidates exist", () => {
    conventionsData = [
      candidate({ id: "1", status: "pending" }),
      candidate({ id: "2", status: "approved" }),
    ];
    renderPage();
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeInTheDocument();
    expect(screen.getByText("Use async/await instead of .then() chains.")).toBeInTheDocument();
    expect(screen.getByText(/Pending · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Accepted · 1/)).toBeInTheDocument();
  });

  it("Create skill is disabled until at least one candidate is accepted", () => {
    conventionsData = [candidate({ id: "1", status: "pending" })];
    renderPage();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });

  it("Create skill is enabled once a candidate is accepted, and opens the modal", () => {
    conventionsData = [candidate({ id: "1", status: "approved" })];
    renderPage();
    const button = screen.getByRole("button", { name: "Create skill" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
  });
});
