# Fix round 1 — PR Brief (hw05-pr-brief)

Execution mode: single agent
Parent plan: [hw05-pr-brief.plan.md](hw05-pr-brief.plan.md)
Source: security-reviewer findings on the uncommitted working tree.

## Steps

### F1 — Repo-controlled spec paths sit outside the `<untrusted>` wrap
- **Files:** `server/src/modules/brief/prompt.ts:208-225` (`renderSpecs`)
- **Change:** address: spec document paths reach the prompt as trusted framing in two places — the wrap label `wrapUntrusted(\`spec:${spec.path}\`, …)` (lines 208, 216, 219; `wrapUntrusted` neutralises content only, not the label) and the `[omitted: ${skipped.join(', ')}]` marker (line 225). Use a fixed label per spec (`spec-${i}`), put the path inside the wrapped content, and replace the omitted-paths marker with either a count (`[+N more specs omitted]`) or a `wrapUntrusted('omitted-specs', …)` block listing them. Keep the SHRINK_ORDER / budget behaviour and the truncation record unchanged. Update `server/test/brief-prompt.test.ts` only as far as existing assertions depend on the old label/marker text (add a case that a path containing `"`, `>` or `</untrusted>` cannot appear outside a wrap).
- **Constraint:** NFR-3 / plan R3 — untrusted text must never be interpolated into trusted framing; mirror reviewer-core `assemblePrompt`'s fixed labels.
- **Owner:** implementer
- **Done when:** the security-reviewer no longer reports this finding on a re-scan; `cd server && pnpm typecheck` and `pnpm exec vitest run --exclude '**/*.it.test.ts'` pass.
