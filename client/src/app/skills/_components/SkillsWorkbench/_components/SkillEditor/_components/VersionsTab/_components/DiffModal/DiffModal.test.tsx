import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../../../../messages/en/skills.json";
import { DiffModal } from "./DiffModal";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

const BASE: SkillVersion = { skill_id: "sk1", version: 1, body: "- keep this\n- drop this", created_at: "2026-01-01" };
const CURRENT: SkillVersion = { skill_id: "sk1", version: 2, body: "- keep this\n- add this", created_at: "2026-02-01" };

describe("DiffModal", () => {
  it("renders removed and added lines with opposite signs", () => {
    renderWithIntl(<DiffModal base={BASE} current={CURRENT} onClose={() => {}} />);
    expect(screen.getByText("- drop this")).toBeInTheDocument();
    expect(screen.getByText("- add this")).toBeInTheDocument();
  });

  it("renders an unchanged line only once, as context", () => {
    renderWithIntl(<DiffModal base={BASE} current={CURRENT} onClose={() => {}} />);
    expect(screen.getAllByText("- keep this")).toHaveLength(1);
  });

  it("shows the no-changes message for two identical versions", () => {
    renderWithIntl(<DiffModal base={BASE} current={BASE} onClose={() => {}} />);
    expect(screen.getByText(messages.editor.versions.noChanges)).toBeInTheDocument();
  });

  it("calls onClose when dismissed", () => {
    const onClose = vi.fn();
    renderWithIntl(<DiffModal base={BASE} current={CURRENT} onClose={onClose} />);
    screen.getByLabelText("Close").click();
    expect(onClose).toHaveBeenCalled();
  });
});
