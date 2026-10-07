# Fix round 1 — L06 Eval pipeline

Execution mode: single agent
Parent plan: [l06-eval-pipeline.plan.md](l06-eval-pipeline.plan.md)
Source: security-reviewer findings (2 WARNING) on the uncommitted working tree. architecture-reviewer returned only a SUGGESTION (agents repository deleting `eval_cases` — accepted as is, not in this round) and accepted R1 (runs outside `container.jobs`).

Nothing is committed or pushed.

## Steps

### F1 — No per-route rate limit on the three eval routes that spend model credits
- **Files:** `server/src/modules/eval/routes.ts:128-135` (`POST /eval/cases/:id/run`), `:137-146` (`POST /agents/:id/eval/runs`), `:186-193` (`POST /eval/runs/all`)
- **Change:** address: these routes trigger paid LLM calls (a single-case run is a synchronous call of up to `EVAL_CASE_TIMEOUT_MS`; "one running run per agent" does not cover single-case runs) and only the global 120 req/min limit applies. Add a per-route `config: { rateLimit: { max, timeWindow: '1 minute' } }` exactly like `POST /pulls/:id/review` at `server/src/modules/reviews/routes.ts:29-34` (same comment style): `max: 10` for `/agents/:id/eval/runs` and `/eval/runs/all`, `max: 20` for `/eval/cases/:id/run` (manual one-off iteration). Put the numbers in the module's constants file, not inline.
- **Constraint:** OWASP A06 / resource abuse; mirror the existing LLM-fan-out route convention.
- **Owner:** implementer
- **Done when:** the three routes carry a rate-limit config and a test (in the existing `server/test/eval-pipeline.it.test.ts` or a unit-level route test) shows the (max+1)-th request within the window returns 429 for one of them; the reviewer no longer reports this finding on a re-scan.

### F2 — State-changing eval POSTs can be triggered cross-site (CSRF-style), `POST /eval/runs/all` needs no ids
- **Files:** `server/src/modules/eval/routes.ts` (the same three routes, plus a shared hook); `server/src/app.ts:100` only for reading `config.webOrigin` (do not change CORS setup)
- **Change:** address: CORS stops an attacker page reading the response, not sending the request, so a page visited while DevDigest runs can start a full eval run for every agent. Add a small `onRequest` (or `preHandler`) hook, scoped to the three LLM-spending eval POST routes only: if the request carries an `Origin` header that is not equal to `config.webOrigin`, reply 403 with the module's standard error shape; requests with no `Origin` header (server-to-server, curl, `app.inject` in tests, same-origin) pass unchanged. Keep the hook in the eval module (no change to other modules' routes — the same exposure exists on pre-existing POSTs and is out of scope here; mention it in the final summary so it can go into `server/INSIGHTS.md`).
- **Constraint:** OWASP A01/A05 (CSRF on state-changing routes); routes stay thin — the check lives in a small helper, not the handlers.
- **Owner:** implementer
- **Done when:** a test shows a POST to `/eval/runs/all` with `Origin: https://evil.example` returns 403 and starts no run, while the same request with the configured web origin (and with no Origin) is accepted; the reviewer no longer reports this finding on a re-scan.

## Verification
- `cd server && pnpm typecheck`
- `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs`
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
- `cd server && pnpm verify:l06` (and once under `env -u OPENAI_API_KEY -u OPENROUTER_API_KEY -u ANTHROPIC_API_KEY`)
- Existing flaky `.it` tests (`reviews.it`, `run-skills.it`) are unrelated: if the full `.it` lane flakes, rerun the failing file alone and report.

## Out of scope
- AC-46 vs FR-16 precision wording and the metric-tile delta unit (awaiting the user's decision).
- The architecture SUGGESTION on `AgentsRepository.deleteById`.
- Committing or pushing.
