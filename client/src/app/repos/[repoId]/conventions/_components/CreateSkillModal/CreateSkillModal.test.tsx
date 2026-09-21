import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionSkillDraft } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const DRAFT: ConventionSkillDraft = {
  name: "repo-conventions",
  description: "2 house conventions extracted from the repository",
  type: "convention",
  enabled: true,
  body: "# Repository Conventions\n\n## Error Handling\n\n- Use async/await.\n  - Evidence: `a.ts:1`",
  evidence_files: ["a.ts"],
  convention_ids: ["c1", "c2"],
  existing_skill_id: null,
};

const createMutate = vi.fn();
vi.mock("@/lib/hooks/conventions", () => ({
  useConventionSkillDraft: () => ({ data: DRAFT, isLoading: false, isError: false, error: undefined }),
  useCreateConventionsSkill: () => ({ mutate: createMutate, isPending: false }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
});

function renderModal(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ToastProvider>
        <CreateSkillModal repoId="repo-1" repoName="acme/app" approvedCount={2} onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return { onClose };
}

describe("CreateSkillModal", () => {
  it("seeds Name/Description/Type/Enabled/Body from the draft, all editable", () => {
    renderModal();
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(screen.getByDisplayValue("repo-conventions")).toBeInTheDocument();
    expect(screen.getByDisplayValue(DRAFT.description)).toBeInTheDocument();
    // getByDisplayValue normalizes whitespace (collapses newlines) by default,
    // so a multi-line body is asserted directly on the textarea's live value.
    expect(document.querySelector("textarea")!.value).toBe(DRAFT.body);

    const nameInput = screen.getByDisplayValue("repo-conventions");
    fireEvent.change(nameInput, { target: { value: "custom-name" } });
    expect(screen.getByDisplayValue("custom-name")).toBeInTheDocument();
  });

  it("explains provenance with the accepted count and repo name", () => {
    renderModal();
    expect(screen.getByText(/Merged from 2 accepted conventions in acme\/app/)).toBeInTheDocument();
  });

  it("Cancel closes without creating anything", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Create posts the user-edited body verbatim, not the original draft", () => {
    renderModal();
    const bodyField = document.querySelector("textarea")!;
    fireEvent.change(bodyField, { target: { value: DRAFT.body + "\n\n(edited)" } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-1",
        input: expect.objectContaining({
          body: DRAFT.body + "\n\n(edited)",
          convention_ids: ["c1", "c2"],
          replace_skill_id: null,
        }),
      }),
      expect.anything(),
    );
  });

  it("shows a conflict banner on 409 and replaces only on explicit confirmation", () => {
    createMutate.mockImplementation((_input, opts) => {
      opts.onError(new ApiError("conflict", 409, "conflict", { existing_skill_id: "sk-existing" }));
    });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    const replaceButton = screen.getByRole("button", { name: "Replace existing" });

    createMutate.mockClear();
    fireEvent.click(replaceButton);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ replace_skill_id: "sk-existing" }),
      }),
      expect.anything(),
    );
  });
});
