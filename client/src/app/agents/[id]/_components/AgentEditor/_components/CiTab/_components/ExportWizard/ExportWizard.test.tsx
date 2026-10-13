import { describe, it, expect, afterEach, beforeEach, onTestFinished, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import type { CiExport } from "@devdigest/shared";
import {
  AGENT,
  REPOS,
  makeInstallation,
  makePreview,
  mockApi,
  renderCi,
  type ApiCall,
} from "@/test/ci-fixtures";
import { ExportWizard } from "./ExportWizard";

/* "Add to CI" wizard: Target → Preview → Configure → Install. `fetch` is
   stubbed at the network seam; hooks/React Query/providers are real. Breakage
   covered: an unsupported target becoming selectable, installing past a
   blocking preview, losing a user's workflow edit silently, sending the wrong
   export body, and the zip missing files. */

const PR_URL = "https://github.com/acme/payments-api/pull/77";

function exportResponse(action: "open_pr" | "files"): CiExport {
  const files = makePreview().files.map((f) =>
    f.role === "runner" && action === "files" ? { ...f, contents: "// runner bundle" } : f,
  );
  return {
    installation: makeInstallation(),
    files,
    pr_url: action === "open_pr" ? PR_URL : null,
  };
}

const routes = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  "GET /repos": { json: REPOS },
  "POST /agents/ag1/ci/preview": { json: makePreview() },
  "POST /agents/ag1/export-ci": (body: unknown) => ({
    status: 201,
    json: exportResponse((body as { action: "open_pr" | "files" }).action),
  }),
  ...extra,
});

const previews = (calls: ApiCall[]) => calls.filter((c) => c.path === "/agents/ag1/ci/preview");
const exports = (calls: ApiCall[]) => calls.filter((c) => c.path === "/agents/ag1/export-ci");
const btn = (name: RegExp | string) => screen.getByRole("button", { name });
const workflowBox = () => screen.getByRole("textbox") as HTMLTextAreaElement;

async function toPreview() {
  await waitFor(() => expect(btn(/Continue/)).toBeEnabled());
  fireEvent.click(btn(/Continue/));
  await screen.findByText("FILES TO CREATE");
  await waitFor(() => expect(btn(/Continue/)).toBeEnabled());
}

let confirmSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  confirmSpy = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExportWizard", () => {
  it("walks Target → Preview → Configure → Install and opens a PR", async () => {
    const calls = mockApi(routes());
    const onClose = vi.fn();
    renderCi(<ExportWizard agent={AGENT} onClose={onClose} />);

    // Target: only GitHub Actions is an option; the other three are inert "coming soon" cards.
    const targets = screen.getByRole("radiogroup", { name: "Target" });
    expect(within(targets).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringContaining("GitHub Actions"),
    ]);
    expect(within(targets).getByRole("radio")).toHaveAttribute("aria-checked", "true");
    for (const key of ["circle", "jenkins", "cli"]) {
      const card = screen.getByTestId(`target-${key}`);
      expect(card).toHaveAttribute("aria-disabled", "true");
      expect(within(card).getByText("coming soon")).toBeInTheDocument();
      fireEvent.click(card);
    }
    expect(within(targets).getByRole("radio")).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByDisplayValue("acme/payments-api")).toBeInTheDocument();

    // Preview: generated files, the workflow editable, the runner by size only.
    await toPreview();
    expect(previews(calls)[0]!.body).toEqual({
      repo: "acme/payments-api",
      target: "gha",
      post_as: "github_review",
      triggers: ["opened", "synchronize"],
    });
    expect(workflowBox().value).toContain("review --agent security-reviewer");
    fireEvent.click(btn(".devdigest/runner.mjs"));
    expect(screen.getByText("generated bundle · 1.5 MB · not editable")).toBeInTheDocument();

    // Configure: at least one trigger; changes regenerate the preview.
    fireEvent.click(btn(/Continue/));
    // The branch-protection how-to is on this step (it is what makes the check block merges).
    expect(screen.getByText("Make this check block merges")).toBeInTheDocument();
    expect(screen.getByText(/Settings → Branches/)).toBeInTheDocument();
    expect(screen.getByText(/Require status checks to pass before merging/)).toBeInTheDocument();
    fireEvent.click(btn("pull_request:opened"));
    fireEvent.click(btn("pull_request:synchronize"));
    expect(screen.getByText("Pick at least one trigger.")).toBeInTheDocument();
    expect(btn(/Continue/)).toBeDisabled();
    fireEvent.click(btn("pull_request:reopened"));
    fireEvent.click(screen.getByRole("radio", { name: "PR comment" }));
    await waitFor(() =>
      expect(previews(calls).at(-1)!.body).toMatchObject({ triggers: ["reopened"], post_as: "pr_comment" }),
    );
    expect(confirmSpy).not.toHaveBeenCalled(); // nothing edited → nothing to confirm

    // Back returns to Preview, Continue comes back.
    fireEvent.click(btn(/Back/));
    expect(screen.getByText("FILES TO CREATE")).toBeInTheDocument();
    fireEvent.click(btn(/Continue/));
    await waitFor(() => expect(btn(/Continue/)).toBeEnabled());
    fireEvent.click(btn(/Continue/));

    // Install: secret reminder, then open the PR.
    expect(screen.getByText("Add OPENROUTER_API_KEY to the repo's Actions secrets before the workflow runs.")).toBeInTheDocument();
    fireEvent.click(btn(/^Install$/));
    expect(await screen.findByText("Pull request ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View pull request" })).toHaveAttribute("href", PR_URL);
    expect(exports(calls)).toHaveLength(1);
    expect(exports(calls)[0]!.body).toEqual({
      repo: "acme/payments-api",
      target: "gha",
      action: "open_pr",
      post_as: "pr_comment",
      triggers: ["reopened"],
      workflow_yaml: null,
    });
    fireEvent.click(btn("Done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("a blocking preview or a preview error disables Continue; a 409 on install shows its reasons", async () => {
    mockApi(
      routes({
        "POST /agents/ag1/ci/preview": {
          json: makePreview({ blocking: [{ code: "provider_unsupported", message: "CI runs use OpenRouter only." }] }),
        },
      }),
    );
    renderCi(<ExportWizard agent={AGENT} onClose={() => {}} />);
    await waitFor(() => expect(btn(/Continue/)).toBeEnabled());
    fireEvent.click(btn(/Continue/));
    expect(await screen.findByRole("alert")).toHaveTextContent("CI runs use OpenRouter only.");
    expect(btn(/Continue/)).toBeDisabled();

    cleanup();
    mockApi(
      routes({
        "POST /agents/ag1/ci/preview": { status: 500, json: { error: { code: "internal", message: "generator exploded" } } },
      }),
    );
    renderCi(<ExportWizard agent={AGENT} onClose={() => {}} />);
    await waitFor(() => expect(btn(/Continue/)).toBeEnabled());
    fireEvent.click(btn(/Continue/));
    expect(await screen.findByText("generator exploded")).toBeInTheDocument();
    expect(btn(/Continue/)).toBeDisabled();

    cleanup();
    mockApi(
      routes({
        "POST /agents/ag1/export-ci": {
          status: 409,
          json: {
            error: {
              code: "conflict",
              message: "blocked",
              details: { blocking: [{ code: "runner_bundle_missing", message: "The CI runner bundle has not been built." }] },
            },
          },
        },
      }),
    );
    renderCi(<ExportWizard agent={AGENT} onClose={() => {}} />);
    await toPreview();
    fireEvent.click(btn(/Continue/));
    fireEvent.click(btn(/Continue/));
    fireEvent.click(btn(/^Install$/));
    expect(await screen.findByRole("alert")).toHaveTextContent("The CI runner bundle has not been built.");
    expect(screen.queryByText("Pull request ready")).not.toBeInTheDocument();
  });

  it("changing triggers after editing the workflow asks first, and only drops the edit when confirmed", async () => {
    const calls = mockApi(routes());
    renderCi(<ExportWizard agent={AGENT} onClose={() => {}} />);
    await toPreview();
    const generated = workflowBox().value;
    const edited = `${generated}# my edit\n`;
    fireEvent.change(workflowBox(), { target: { value: edited } });
    expect(btn("Reset to generated")).toBeInTheDocument();

    fireEvent.click(btn(/Continue/));
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(btn("pull_request:reopened"));
    expect(confirmSpy).toHaveBeenCalledWith("Regenerate the workflow? Your edits will be lost.");
    fireEvent.click(btn(/Back/));
    expect(workflowBox().value).toBe(edited); // declined → edit kept

    fireEvent.click(btn(/Continue/));
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(btn("pull_request:reopened"));
    fireEvent.click(btn(/Back/));
    await waitFor(() => expect(workflowBox().value).toBe(generated)); // confirmed → regenerated
    await waitFor(() => expect(btn(/Continue/)).toBeEnabled());
    fireEvent.click(btn(/Continue/));
    fireEvent.click(btn(/Continue/));
    fireEvent.click(btn(/^Install$/));
    await screen.findByText("Pull request ready");
    expect(exports(calls)[0]!.body).toMatchObject({
      triggers: ["opened", "synchronize", "reopened"],
      workflow_yaml: null,
    });
  });

  it("'Copy files as a zip' sends the edited workflow and downloads every returned file", async () => {
    let blob: Blob | null = null;
    let downloaded: { name: string; href: string } | null = null;
    // jsdom has no object URLs: provide them for this test only.
    const urlApi = URL as unknown as Record<string, unknown>;
    urlApi.createObjectURL = (b: Blob) => {
      blob = b;
      return "blob:ci-zip";
    };
    urlApi.revokeObjectURL = () => {};
    onTestFinished(() => {
      delete urlApi.createObjectURL;
      delete urlApi.revokeObjectURL;
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = { name: this.download, href: this.getAttribute("href") ?? "" };
    });

    const calls = mockApi(routes());
    renderCi(<ExportWizard agent={AGENT} onClose={() => {}} />);
    await toPreview();
    const edited = `${workflowBox().value}# zip edit\n`;
    fireEvent.change(workflowBox(), { target: { value: edited } });
    fireEvent.click(btn(/Continue/));
    fireEvent.click(btn(/Continue/));
    fireEvent.click(screen.getByRole("radio", { name: /Copy files as a zip/ }));
    fireEvent.click(btn(/^Install$/));

    expect(await screen.findByText("Zip downloaded")).toBeInTheDocument();
    expect(exports(calls)[0]!.body).toMatchObject({ action: "files", workflow_yaml: edited });
    expect(downloaded).toEqual({ name: "devdigest-ci-security-reviewer.zip", href: "blob:ci-zip" });

    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob!);
    });
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(exportResponse("files").files.map((f) => f.path).sort());
    expect(strFromU8(entries[".devdigest/runner.mjs"]!)).toBe("// runner bundle");
  });
});
