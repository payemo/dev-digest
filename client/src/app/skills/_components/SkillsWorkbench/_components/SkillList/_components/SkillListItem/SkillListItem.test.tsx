import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/skills.json";

const SKILL: Skill = {
  id: "sk1",
  name: "API contract compatibility",
  description: "Flag breaking route-signature changes.",
  type: "rubric",
  source: "manual",
  body: "- rule",
  enabled: true,
  version: 1,
  evidence_files: null,
};

const deleteMutate = vi.fn();
const updateMutate = vi.fn();
let agentsData: unknown[] | undefined = [
  { agent_id: "a1", agent_name: "General", enabled: true, order: 0 },
  { agent_id: "a2", agent_name: "Security", enabled: true, order: 0 },
];

vi.mock("../../../../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
  useSkillAgents: () => ({ data: agentsData, isLoading: false, isError: false }),
}));

import { SkillListItem } from "./SkillListItem";

afterEach(() => {
  cleanup();
  deleteMutate.mockClear();
  agentsData = [
    { agent_id: "a1", agent_name: "General", enabled: true, order: 0 },
    { agent_id: "a2", agent_name: "Security", enabled: true, order: 0 },
  ];
});

function renderItem(props: Partial<React.ComponentProps<typeof SkillListItem>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillListItem skill={SKILL} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SkillListItem", () => {
  it("shows the linked-agent count", () => {
    renderItem();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
  });

  it("deletes on confirm, naming the linked-agent count in the prompt", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderItem();
    fireEvent.click(screen.getByLabelText("Delete skill"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("2 agents"));
    expect(deleteMutate).toHaveBeenCalledWith("sk1");
  });

  it("does not delete when the confirm is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderItem();
    fireEvent.click(screen.getByLabelText("Delete skill"));
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("does not surface an agent count while the agents query hasn't resolved", () => {
    agentsData = undefined;
    renderItem();
    expect(screen.queryByText(/agent/)).not.toBeInTheDocument();
  });
});
