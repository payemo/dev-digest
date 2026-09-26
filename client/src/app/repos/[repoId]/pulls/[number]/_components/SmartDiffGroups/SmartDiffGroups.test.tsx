/* SmartDiffGroups — the five-group role ordering of the Files changed tab.
   The fixture deliberately leaves `docs` empty: all five headers must still
   render, the empty one reading "0 files". */
import { describe, it, expect, afterEach } from "vitest";
// `@testing-library/user-event` is not a dependency of this package and this
// change adds none — `fireEvent` is the idiom every other test here uses.
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiffGroup } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import type { DiffFindingApi } from "@/components/diff-viewer";
import { SmartDiffGroups } from "./SmartDiffGroups";

afterEach(cleanup);

const PATCH = ["@@ -1,1 +1,2 @@", " const a = 1;", "+const b = 2;"].join("\n");

const FILES: PrFile[] = [
  { path: "src/pay.ts", additions: 20, deletions: 2, patch: PATCH },
  { path: "src/auth.ts", additions: 9, deletions: 1, patch: PATCH },
  { path: "src/pay.test.ts", additions: 30, deletions: 0, patch: PATCH },
  { path: "src/index.ts", additions: 2, deletions: 0, patch: PATCH },
  { path: "pnpm-lock.yaml", additions: 120, deletions: 8, patch: PATCH },
];

function file(path: string) {
  return { path, pseudocode_summary: null, additions: 0, deletions: 0, finding_lines: [] };
}

/** Five groups, `docs` intentionally empty. */
const GROUPS: SmartDiffGroup[] = [
  { role: "core", files: [file("src/pay.ts"), file("src/auth.ts")] },
  { role: "tests", files: [file("src/pay.test.ts")] },
  { role: "wiring", files: [file("src/index.ts")] },
  { role: "docs", files: [] },
  { role: "boilerplate", files: [file("pnpm-lock.yaml")] },
];

/** Five findings across TWO files — the header counter must read 2, not 5. */
const FINDINGS: DiffFindingApi = {
  anchors: [
    { id: "f1", path: "src/pay.ts", line: 2, severity: "CRITICAL", label: "blocker" },
    { id: "f2", path: "src/pay.ts", line: 2, severity: "WARNING", label: "warning" },
    { id: "f3", path: "src/pay.ts", line: 2, severity: "SUGGESTION", label: "suggestion" },
    { id: "f4", path: "src/auth.ts", line: 2, severity: "WARNING", label: "warning" },
    { id: "f5", path: "src/auth.ts", line: 2, severity: "WARNING", label: "warning" },
  ],
  showFindings: true,
  unanchoredLabel: "Findings not in this patch",
  render: (id) => <div>finding body {id}</div>,
};

function renderGroups(props: Partial<React.ComponentProps<typeof SmartDiffGroups>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffGroups groups={GROUPS} files={FILES} hasReview {...props} />
    </NextIntlClientProvider>,
  );
}

/** Each group is a labelled <section>; its header is that region's first button. */
function groups() {
  return screen.getAllByRole("region");
}
function header(label: string) {
  return within(screen.getByRole("region", { name: label })).getAllByRole("button")[0]!;
}

describe("SmartDiffGroups", () => {
  it("renders exactly five headers in role order, each with its label, description and file count", () => {
    renderGroups();

    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("Tests")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();

    // Descriptions come from the message catalog, not from a constants file.
    expect(screen.getByText("The substance of the change — review closely")).toBeInTheDocument();
    expect(screen.getByText("Generated / mechanical — skim")).toBeInTheDocument();

    // Exactly five, in the fixed role order.
    expect(groups().map((g) => g.getAttribute("aria-label"))).toEqual([
      "Core logic",
      "Tests",
      "Wiring",
      "Docs",
      "Boilerplate",
    ]);
    expect(header("Core logic")).toHaveTextContent("2 files");
    expect(header("Tests")).toHaveTextContent("1 files");
  });

  it("still renders an EMPTY docs group, collapsed, reading 0 files with no counter", () => {
    renderGroups();

    const docs = header("Docs");
    expect(docs).toHaveTextContent("0 files");
    expect(docs).toHaveAttribute("aria-expanded", "false");
    expect(within(docs).queryByText(/with findings/)).not.toBeInTheDocument();
  });

  it("collapses docs and boilerplate to header rows, and reveals the files on click", () => {
    renderGroups();

    // Collapsed: the lock file's card is not rendered at all.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    // …while an open group's files are.
    expect(screen.getByText("src/pay.ts")).toBeInTheDocument();

    fireEvent.click(header("Boilerplate"));

    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("counts FILES with findings, not findings: five findings over two files reads 2", () => {
    renderGroups({ findings: FINDINGS });

    expect(within(header("Core logic")).getByText("2 with findings")).toBeInTheDocument();
    // A group whose files were never cited shows no counter.
    expect(within(header("Tests")).queryByText(/with findings/)).not.toBeInTheDocument();
  });

  it("replaces the counters with the empty state when no review has run", () => {
    renderGroups({ hasReview: false });

    expect(screen.getAllByText("No review has been run yet")).toHaveLength(5);
    expect(screen.queryByText(/with findings/)).not.toBeInTheDocument();
  });
});
