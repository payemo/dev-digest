import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../lib/toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/skills",
}));

// AppShell pulls in the full sidebar/topbar/command-palette stack (theme,
// repo context, keyboard shortcuts) that has nothing to do with what this
// test verifies — the skill list + selection logic. Mock it to a passthrough
// so the test stays focused on SkillsWorkbench's own behavior.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const SKILLS: Skill[] = [
  {
    id: "sk1",
    name: "API contract compatibility",
    description: "Flag breaking route-signature changes.",
    type: "rubric",
    source: "manual",
    body: "- rule",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
];

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkill: () => ({ data: undefined, isLoading: false, isError: false, error: undefined, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillAgents: () => ({ data: [], isLoading: false, isError: false }),
}));

import { SkillsWorkbench } from "./SkillsWorkbench";

afterEach(cleanup);

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillsWorkbench (smoke)", () => {
  it("lists seeded skills and shows the select-a-skill empty state with no id", () => {
    renderWithProviders(<SkillsWorkbench />);
    expect(screen.getByText("API contract compatibility")).toBeInTheDocument();
    expect(screen.getByText("Select a skill")).toBeInTheDocument();
  });

  it("navigates to the skill's editor on click", () => {
    renderWithProviders(<SkillsWorkbench />);
    fireEvent.click(screen.getByText("API contract compatibility"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/skills/sk1"));
  });
});
