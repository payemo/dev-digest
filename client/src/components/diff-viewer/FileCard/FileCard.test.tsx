/* FileCard — the findings surface on one file: the presence dot, the inline
   body under the cited line, and the footer block for a finding whose line is
   not in this patch. The dot and the GitHub comment counter are deliberately
   different things, so one test pins that they don't get merged. */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, PrReviewComment } from "@devdigest/shared";
import shell from "../../../../messages/en/shell.json";
import type { DiffFindingApi } from "../findings";
import { FileCard } from "./FileCard";

afterEach(cleanup);

const FILE: PrFile = {
  path: "src/config.ts",
  additions: 3,
  deletions: 0,
  patch: [
    "@@ -10,2 +10,5 @@",
    " const a = 1;",
    "+const stripeKey = 'sk_live_xyz';",
    "+const b = 2;",
    "+const c = 3;",
  ].join("\n"),
};

function findingApi(over: Partial<DiffFindingApi> = {}): DiffFindingApi {
  return {
    anchors: [
      {
        id: "f1",
        path: "src/config.ts",
        line: 12,
        severity: "CRITICAL",
        label: "blocker",
      },
    ],
    showFindings: true,
    unanchoredLabel: "Findings not in this patch",
    render: (id) => <div>finding body {id}</div>,
    ...over,
  };
}

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FileCard findings", () => {
  it("renders no dot and no finding body when the findings prop is omitted", () => {
    renderCard(<FileCard file={FILE} />);

    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.queryByTestId("finding-dot")).not.toBeInTheDocument();
    expect(screen.queryByText(/finding body/)).not.toBeInTheDocument();
    expect(screen.queryByText("blocker")).not.toBeInTheDocument();
  });

  it("shows the dot, the severity label and the body under the line it cites", () => {
    renderCard(<FileCard file={FILE} findings={findingApi()} />);

    expect(screen.getByTestId("finding-dot")).toBeInTheDocument();
    // The severity label is a <span>, NOT a button — query it as text.
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "blocker" })).not.toBeInTheDocument();
    expect(screen.getByText(/finding body f1/)).toBeInTheDocument();
    // Nothing fell through to the "not in this patch" footer.
    expect(screen.queryByText("Findings not in this patch")).not.toBeInTheDocument();
  });

  it("routes a finding whose line is not in the patch into the footer block, dot still shown", () => {
    const api = findingApi({
      anchors: [
        { id: "f9", path: "src/config.ts", line: 999, severity: "WARNING", label: "warning" },
      ],
    });
    renderCard(<FileCard file={FILE} findings={api} />);

    expect(screen.getByTestId("finding-dot")).toBeInTheDocument();
    expect(screen.getByText("Findings not in this patch")).toBeInTheDocument();
    expect(screen.getByText(/finding body f9/)).toBeInTheDocument();
  });

  it("puts every finding in the footer for a file with no patch at all", () => {
    renderCard(
      <FileCard file={{ ...FILE, patch: null }} findings={findingApi()} />,
    );

    expect(screen.getByText("No diff text available (binary or unfetched patch).")).toBeInTheDocument();
    expect(screen.getByText("Findings not in this patch")).toBeInTheDocument();
    expect(screen.getByText(/finding body f1/)).toBeInTheDocument();
  });

  it("keeps the dot but hides the bodies when showFindings is false", () => {
    renderCard(<FileCard file={FILE} findings={findingApi({ showFindings: false })} />);

    expect(screen.getByTestId("finding-dot")).toBeInTheDocument();
    expect(screen.queryByText(/finding body/)).not.toBeInTheDocument();
  });

  it("shows the comment counter and NO dot for a file with comments but no findings", () => {
    const comments: PrReviewComment[] = [
      {
        id: 1,
        path: "src/config.ts",
        line: 11,
        original_line: 11,
        side: "RIGHT",
        body: "Is this right?",
        user: "octocat",
        created_at: "2026-01-01T00:00:00Z",
        in_reply_to_id: null,
        html_url: "https://github.com/acme/repo/pull/1#discussion_r1",
        is_outdated: false,
      },
    ];
    renderCard(
      <FileCard
        file={FILE}
        commenting={{
          comments,
          canComment: false,
          showComments: true,
          posting: false,
          onSubmit: async () => undefined,
        }}
      />,
    );

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByTestId("finding-dot")).not.toBeInTheDocument();
  });
});
