/* Project Context page — list, read-only preview, sync footer, empty state,
   and intake rejection.

   The shell and repo resolution are mocked (as the Conventions page test
   does); the data hooks are REAL and `fetch` is stubbed with a small
   in-memory API, so zod response parsing and the error envelope run as they
   would in the browser. `user-event` is not installed here, so `fireEvent`. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextDocument, ContextSetStatus } from "@devdigest/shared";
import messages from "../../../../../messages/en/context.json";

const REPO = "11111111-1111-4111-8111-111111111111";
const ID_SPEC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "11111111-1111-4111-8111-111111111111" }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/repo-not-found", () => ({
  RepoNotFound: () => <div>repo not found</div>,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments" } }),
  useRepoNotFound: () => false,
}));

import ProjectContextPage from "./page";

function doc(id: string, over: Partial<ContextDocument>): ContextDocument {
  return {
    id,
    path: ".devdigest/specs/x.md",
    name: "x.md",
    folder: "",
    category: "specs",
    origin: "repo",
    availability: "present",
    size_bytes: 10,
    token_count: 10,
    fingerprint: "f",
    updated_at: "2026-09-29T10:00:00.000Z",
    used_by_agents: 0,
    ...over,
  };
}

const DOCS: ContextDocument[] = [
  doc(ID_SPEC, {
    path: ".devdigest/specs/api/public-api.md",
    name: "public-api.md",
    folder: "api",
    category: "specs",
    origin: "repo",
    used_by_agents: 2,
  }),
  doc(ID_DOC, {
    path: ".devdigest/docs/onboarding.md",
    name: "onboarding.md",
    category: "docs",
    origin: "user",
  }),
];

const CONTENT = "# Public API\n\nEvery endpoint is **versioned**.";

let documents: ContextDocument[] = [];
let status: ContextSetStatus;
let createResponse: { status: number; body: unknown } = { status: 201, body: {} };
let posts: unknown[] = [];

function json(body: unknown, code = 200) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  documents = DOCS;
  status = {
    document_count: 2,
    last_synced_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    health: "fresh",
    reason: null,
  };
  posts = [];
  createResponse = { status: 201, body: {} };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const base = `/repos/${REPO}/context`;
      if (path === `${base}/documents` && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json(createResponse.body, createResponse.status);
      }
      if (path === `${base}/documents`) return json(documents);
      if (path === `${base}/documents/${ID_SPEC}`) {
        return json({ ...DOCS[0], content: CONTENT });
      }
      if (path === `${base}/status`) return json(status);
      return json({ error: { message: `unexpected ${path}` } }, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ProjectContextPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("Project Context page", () => {
  it("groups documents by category with origin badges, previews one read-only, and shows the sync footer", async () => {
    renderPage();

    const specs = await screen.findByRole("region", { name: "Specs" });
    const docs = screen.getByRole("region", { name: "Docs" });
    expect(within(specs).getByText("public-api.md")).toBeInTheDocument();
    expect(within(specs).getByText("in repo")).toBeInTheDocument();
    expect(within(specs).getByText(/used by 2 agents/)).toBeInTheDocument();
    expect(within(docs).getByText("onboarding.md")).toBeInTheDocument();
    expect(within(docs).getByText("added here")).toBeInTheDocument();

    // Footer: count + elapsed + health, and nothing about chunks.
    expect(await screen.findByText(/2 documents · last synced 5m · up to date/)).toBeInTheDocument();
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();

    fireEvent.click(within(specs).getByRole("button", { name: /public-api\.md/ }));

    expect(await screen.findByText(".devdigest/specs/api/public-api.md")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Public API" })).toBeInTheDocument();
    expect(screen.getByText("versioned")).toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();

    // No edit affordance, no save, no token gauge on a read-only preview; and a
    // repo-discovered document offers no delete.
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /content/i })).not.toBeInTheDocument();
  });

  it("explains a failed sync in the footer", async () => {
    status = { document_count: 2, last_synced_at: null, health: "failed", reason: "no_clone" };
    renderPage();

    expect(await screen.findByText(/never synced · last refresh failed/)).toBeInTheDocument();
    expect(screen.getByText(/isn’t cloned locally yet/)).toBeInTheDocument();
  });

  it("shows the empty state when the repository has no documents", async () => {
    documents = [];
    renderPage();

    expect(await screen.findByText("No documents yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Specs" })).not.toBeInTheDocument();
  });

  it("rejects a non-Markdown file before sending, and shows the server's reason when it refuses one", async () => {
    createResponse = {
      status: 409,
      body: { error: { code: "conflict", message: "A document already exists at .devdigest/specs/notes.md." } },
    };
    renderPage();
    await screen.findByRole("region", { name: "Specs" });

    fireEvent.click(screen.getByRole("button", { name: "Add document" }));
    const dialog = screen.getByRole("dialog");

    // Client-side pre-check: wrong extension, never reaches the server.
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. public-api.md"), {
      target: { value: "notes.txt" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("# Public API — PRD"), {
      target: { value: "# Notes" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add document" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Only Markdown files are supported (.md, .markdown).",
    );
    expect(posts).toHaveLength(0);

    // Upload a real .md file: its text becomes the body and its name the file name.
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. public-api.md"), {
      target: { value: "" },
    });
    const file = new File(["# Notes\n\nFrom disk."], "notes.md", { type: "text/markdown" });
    fireEvent.change(within(dialog).getByLabelText("Upload a .md file"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(within(dialog).getByPlaceholderText("e.g. public-api.md")).toHaveValue("notes.md"),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Add document" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A document already exists at .devdigest/specs/notes.md.",
    );
    expect(posts).toEqual([{ category: "specs", folder: "", name: "notes.md", body: "# Notes\n\nFrom disk." }]);
    // The modal stays open so the user can fix it.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
