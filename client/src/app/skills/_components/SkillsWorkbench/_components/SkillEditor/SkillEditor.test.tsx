import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../../lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useSkillStats: () => ({ data: EMPTY_STATS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "API contract compatibility",
  description: "Flag breaking route-signature changes.",
  type: "rubric",
  source: "manual",
  body: "- A renamed response field is a breaking change.",
  enabled: true,
  version: 1,
  evidence_files: null,
};

const EMPTY_STATS: SkillStats = {
  skill_id: "sk1",
  window_days: 30,
  used_by_agents: 0,
  linked_agent_runs: 0,
  injected_runs: 0,
  pull_frequency_pct: null,
  findings: 0,
  accepted: 0,
  dismissed: 0,
  accept_rate: null,
  by_category: [],
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("Skill Editor (smoke)", () => {
  it("renders all four tab labels", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("Versions")).toBeInTheDocument();
  });

  it("renders the Config tab fields by default", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders the skill body in the Preview tab", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="preview" onTab={() => {}} />);
    expect(screen.getByText(/renamed response field/)).toBeInTheDocument();
  });

  it("renders — (not 0%) for null rates in the Stats tab", () => {
    renderWithIntl(<SkillEditor skill={SKILL} tab="stats" onTab={() => {}} />);
    // Two metric tiles (pull frequency, accept rate) both have null rates.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
