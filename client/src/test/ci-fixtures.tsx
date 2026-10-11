/* Shared fixtures for the Export to CI / CI Runs tests: contract-valid DTOs, a
   routed `fetch` stub (the one network seam every `src/lib/hooks/*` call goes
   through) and a render helper with the real providers. */
import React from "react";
import { vi } from "vitest";
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiAgentOverview, CiInstallation, CiPreview, CiRun, Repo } from "@devdigest/shared";
import ciMessages from "../../messages/en/ci.json";
import { ToastProvider } from "@/lib/toast";
import { RepoProvider } from "@/lib/repo-context";

export const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

export const REPOS: Repo[] = [
  {
    id: "r1",
    workspace_id: "w1",
    owner: "acme",
    name: "payments-api",
    full_name: "acme/payments-api",
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  },
  {
    id: "r2",
    workspace_id: "w1",
    owner: "acme",
    name: "web",
    full_name: "acme/web",
    default_branch: "main",
    clone_path: null,
    last_polled_at: null,
    created_by: null,
  },
];

export function makeInstallation(o: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "i1",
    agent_id: "ag1",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-10-01T00:00:00Z",
    branch: "devdigest/ci",
    pr_url: "https://github.com/acme/payments-api/pull/12",
    workflow_version: 1,
    manifest_version: 3,
    runner_version: "2",
    outdated: false,
    last_run: null,
    ...o,
  };
}

export function makeRun(o: Partial<CiRun> = {}): CiRun {
  return {
    id: "c1",
    ci_installation_id: "i1",
    pr_number: 482,
    ran_at: "2026-10-10T12:00:00Z",
    status: "succeeded",
    findings_count: 2,
    cost_usd: 0.0123,
    github_url: "https://github.com/acme/payments-api/actions/runs/1",
    source: "gha",
    agent: "Security Reviewer",
    agent_id: "ag1",
    repo: "acme/payments-api",
    repo_id: null,
    verdict: "REQUEST_CHANGES",
    duration_ms: 65_000,
    job_url: "https://github.com/acme/payments-api/actions/runs/1",
    verification: "verified",
    reported_findings_count: 2,
    ...o,
  };
}

export function makeOverview(o: Partial<CiAgentOverview> = {}): CiAgentOverview {
  return {
    agent_id: "ag1",
    ci_fail_on: "critical",
    active_repos: 1,
    installations: [makeInstallation()],
    recent_runs: [],
    ...o,
  };
}

const WORKFLOW = `name: "DevDigest review — Security Reviewer"
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  review:
    steps:
      - run: node .devdigest/runner.mjs review --agent security-reviewer
`;

export function makePreview(o: Partial<CiPreview> = {}): CiPreview {
  return {
    files: [
      { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security Reviewer\n", editable: false, role: "manifest", size_bytes: 24 },
      { path: ".devdigest/memory.jsonl", contents: "", editable: false, role: "memory", size_bytes: 0 },
      { path: ".github/workflows/devdigest-review-security-reviewer.yml", contents: WORKFLOW, editable: true, role: "workflow", size_bytes: WORKFLOW.length },
      { path: ".devdigest/runner.mjs", contents: "", editable: false, role: "runner", size_bytes: 1_572_864 },
    ],
    workflow_path: ".github/workflows/devdigest-review-security-reviewer.yml",
    branch: "devdigest/ci",
    blocking: [],
    secret_names: ["OPENROUTER_API_KEY"],
    ...o,
  };
}

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

type Reply = { status?: number; json?: unknown } | ((body: unknown, call: ApiCall) => { status?: number; json?: unknown });

/**
 * Stub `fetch` with a route table keyed "METHOD /path" (path without the
 * query string). Unrouted calls answer 404 so a missing route fails loudly.
 * Returns the recorded calls.
 */
export function mockApi(routes: Record<string, Reply>): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const call = { method, path: url.pathname + url.search, body };
      calls.push(call);
      const route = routes[`${method} ${url.pathname}`];
      const reply = typeof route === "function" ? route(body, call) : route;
      if (!reply) {
        return new Response(JSON.stringify({ error: { code: "not_found", message: `unrouted ${method} ${url.pathname}` } }), { status: 404 });
      }
      return new Response(JSON.stringify(reply.json ?? {}), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

export const SYNC_OK = { json: { ingested: 0, failed_runs: 0, skipped: 0, rejected: [], errors: [] } };

/** Real providers: React Query (no retries), next-intl (ci messages), toasts, repos. */
export function renderCi(ui: React.ReactElement): RenderResult {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }} timeZone="UTC">
        <ToastProvider>
          <RepoProvider>{ui}</RepoProvider>
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
