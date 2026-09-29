/* ContextAttachments — the shared Context tab for an agent and for a skill.

   `fetch` is stubbed with a tiny in-memory API so the real hooks (and their
   zod response schemas) run, and every PUT body can be asserted: the contract
   is that each gesture writes the WHOLE ordered id list. `user-event` is not
   installed in this package, so interactions use `fireEvent`. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextAttachmentSet, ContextDocument, ContextProvenance } from "@devdigest/shared";
import messages from "../../../messages/en/context.json";
import { ContextAttachments } from "./ContextAttachments";

const REPO = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function doc(id: string, over: Partial<ContextDocument>): ContextDocument {
  return {
    id,
    path: `.devdigest/${over.category ?? "specs"}/${over.name ?? "x.md"}`,
    name: "x.md",
    folder: "",
    category: "specs",
    origin: "repo",
    availability: "present",
    size_bytes: 100,
    token_count: 100,
    fingerprint: "f",
    updated_at: "2026-09-29T10:00:00.000Z",
    used_by_agents: 0,
    ...over,
  };
}

// Rendered order is category (specs, docs, insights) then path.
const DOCS: ContextDocument[] = [
  doc(ID_A, { name: "api.md", category: "specs", token_count: 1200 }),
  doc(ID_B, { name: "limits.md", category: "specs", token_count: 300, availability: "missing" }),
  doc(ID_C, { name: "style.md", category: "docs", token_count: 7000, origin: "user" }),
];

/** Server-side state of this owner's own attachment list. */
let attached: { id: string; provenance: ContextProvenance }[] = [];
let puts: string[][] = [];

function setFor(kind: "agent" | "skill"): ContextAttachmentSet {
  const documents = attached.map((a) => ({
    document: DOCS.find((d) => d.id === a.id)!,
    provenance: a.provenance,
  }));
  const total = documents.reduce((n, d) => n + d.document.token_count, 0);
  return {
    repo_id: REPO,
    owner_kind: kind,
    owner_id: OWNER,
    documents,
    total_tokens: total,
    budget_threshold: 8000,
    over_budget: total > 8000,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubApi(kind: "agent" | "skill") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === `/repos/${REPO}/context/documents`) return json(DOCS);
      if (path.endsWith("/attachments")) {
        if (init?.method === "PUT") {
          const ids = (JSON.parse(String(init.body)) as { document_ids: string[] }).document_ids;
          puts.push(ids);
          const inherited = attached.filter((a) => a.provenance === "inherited");
          attached = [...ids.map((id) => ({ id, provenance: "direct" as const })), ...inherited];
        }
        return json(setFor(kind));
      }
      return json({ error: { message: `unexpected ${path}` } }, 404);
    }),
  );
}

function renderTab(kind: "agent" | "skill" = "agent") {
  stubApi(kind);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextAttachments ownerKind={kind} ownerId={OWNER} repoId={REPO} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The switches, in rendered row order: api.md, limits.md, style.md. */
async function switches() {
  await screen.findByText("api.md");
  return screen.getAllByRole("switch");
}

beforeEach(() => {
  attached = [];
  puts = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContextAttachments (agent)", () => {
  it("toggling and reordering each PUT the whole ordered list, and the total sums the attached rows", async () => {
    renderTab("agent");
    const [api, limits] = await switches();
    expect(screen.getByText("≈ 0 tokens attached")).toBeInTheDocument();

    fireEvent.click(api!);
    await waitFor(() => expect(puts).toEqual([[ID_A]]));
    fireEvent.click(limits!);
    await waitFor(() => expect(puts.at(-1)).toEqual([ID_A, ID_B]));

    // 1200 + 300 — the stored per-document counts, summed.
    expect(await screen.findByText("≈ 1500 tokens attached")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();

    // limits.md is second; moving it up writes the new order in one request.
    const moveUp = screen.getAllByRole("button", { name: "Move up" });
    fireEvent.click(moveUp[1]!);
    await waitFor(() => expect(puts.at(-1)).toEqual([ID_B, ID_A]));

    // Detaching removes only that id.
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    await waitFor(() => expect(puts.at(-1)).toEqual([ID_B]));
    expect(await screen.findByText("≈ 300 tokens attached")).toBeInTheDocument();
  });

  it("flags a missing document, filters the list, and warns over budget without blocking a write (D-3)", async () => {
    attached = [
      { id: ID_A, provenance: "direct" },
      { id: ID_C, provenance: "direct" },
    ]; // 1200 + 7000 = 8200 > 8000
    renderTab("agent");
    await switches();

    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Above the 8000-token guide");
    expect(screen.getByText("≈ 8200 tokens attached")).toBeInTheDocument();

    // Still writable while over the threshold.
    fireEvent.click(screen.getAllByRole("switch")[1]!); // limits.md
    await waitFor(() => expect(puts.at(-1)).toEqual([ID_A, ID_C, ID_B]));

    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents…" }), {
      target: { value: "sty" },
    });
    expect(screen.getByText("style.md")).toBeInTheDocument();
    expect(screen.queryByText("api.md")).not.toBeInTheDocument();
    expect(screen.queryByText("limits.md")).not.toBeInTheDocument();
  });

  it("never writes an inherited-only document into the agent's own list", async () => {
    attached = [
      { id: ID_A, provenance: "direct" },
      { id: ID_C, provenance: "inherited" },
    ];
    renderTab("agent");
    const [, limits, style] = await switches();

    expect(screen.getByText("via skill")).toBeInTheDocument();
    fireEvent.click(style!); // the inherited switch is read-only
    fireEvent.click(limits!);
    await waitFor(() => expect(puts).toEqual([[ID_A, ID_B]]));
  });
});

describe("ContextAttachments (skill)", () => {
  it("previews the attached paths under the real ## Project context block", async () => {
    attached = [{ id: ID_A, provenance: "direct" }];
    renderTab("skill");
    await switches();

    expect(screen.getByText("Project context to use")).toBeInTheDocument();
    const preview = screen.getByText(
      (_, el) =>
        el?.tagName === "DIV" && el.textContent === "## Project context\n- .devdigest/specs/api.md",
    );
    expect(preview).toBeInTheDocument();
  });
});
