import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const SKILLS: Skill[] = [
  {
    id: "sk-a",
    name: "Attached rubric",
    description: "d",
    type: "rubric",
    source: "manual",
    body: "b",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
  {
    id: "sk-b",
    name: "Unattached rubric",
    description: "d",
    type: "rubric",
    source: "manual",
    body: "b",
    enabled: true,
    version: 1,
    evidence_files: null,
  },
  {
    id: "sk-c",
    name: "Attached but disabled",
    description: "d",
    type: "rubric",
    source: "manual",
    body: "b",
    enabled: false,
    version: 1,
    evidence_files: null,
  },
];

const LINKS: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "sk-a", order: 0 },
  { agent_id: "ag1", skill_id: "sk-c", order: 1 },
];

const mutate = vi.fn();
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkills: () => ({ data: LINKS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetAgentSkills: () => ({ mutate }),
}));
vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Test Agent",
  description: "d",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Agent Skills tab (smoke)", () => {
  it("shows attached skills first, in order, and unattached skills below", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("Attached rubric")).toBeInTheDocument();
    expect(screen.getByText("Unattached rubric")).toBeInTheDocument();
    expect(screen.getByText("2 attached")).toBeInTheDocument();
  });

  it("renders a 'not injected' badge for an attached-but-disabled skill", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("disabled — not injected")).toBeInTheDocument();
  });

  it("attaching an unattached skill appends it last", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const toggles = screen.getAllByRole("switch");
    // Attached: sk-a, sk-c (2 toggles); then unattached: sk-b (3rd toggle).
    fireEvent.click(toggles[2]!);
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk-a", "sk-c", "sk-b"] });
  });

  it("detaching an attached skill removes just that id", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const toggles = screen.getAllByRole("switch");
    fireEvent.click(toggles[0]!); // detach sk-a
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk-c"] });
  });

  it("moving the second attached skill up swaps it with the first", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    const upButtons = screen.getAllByLabelText("Move up");
    fireEvent.click(upButtons[1]!); // sk-c's up button
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk-c", "sk-a"] });
  });
});
