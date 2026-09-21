import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../../../lib/toast";

const mutate = vi.fn();
vi.mock("../../../../../../../../lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
  vi.restoreAllMocks();
});

const SKILL: Skill = {
  id: "sk1",
  name: "API contract compatibility",
  description: "Flag breaking route-signature changes.",
  type: "rubric",
  source: "manual",
  body: "- v2 body",
  enabled: true,
  version: 2,
  evidence_files: null,
};

const VERSIONS: SkillVersion[] = [
  { skill_id: "sk1", version: 2, body: "- v2 body", created_at: "2026-02-01" },
  { skill_id: "sk1", version: 1, body: "- v1 body", created_at: "2026-01-01" },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("VersionsTab", () => {
  it("shows the Current badge on the active version only", () => {
    renderWithIntl(<VersionsTab skill={SKILL} />);
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("shows Diff and Restore for an earlier version, not the current one", () => {
    renderWithIntl(<VersionsTab skill={SKILL} />);
    expect(screen.getAllByText("Diff")).toHaveLength(1);
    expect(screen.getAllByText("Restore")).toHaveLength(1);
  });

  it("does not render a body preview pane", () => {
    renderWithIntl(<VersionsTab skill={SKILL} />);
    expect(screen.queryByText("- v1 body")).not.toBeInTheDocument();
  });

  it("opens the diff modal comparing the selected version to current", () => {
    renderWithIntl(<VersionsTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Diff"));
    expect(screen.getByText("v1 → current (v2)")).toBeInTheDocument();
  });

  it("restores an earlier version's body after confirmation", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithIntl(<VersionsTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Restore"));
    expect(mutate).toHaveBeenCalledWith(
      { id: "sk1", patch: { body: "- v1 body" } },
      expect.objectContaining({ onSuccess: expect.any(Function), onSettled: expect.any(Function) }),
    );
  });

  it("does not restore when the confirmation is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithIntl(<VersionsTab skill={SKILL} />);
    fireEvent.click(screen.getByText("Restore"));
    expect(mutate).not.toHaveBeenCalled();
  });
});
