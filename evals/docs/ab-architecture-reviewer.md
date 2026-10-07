# A/B: `architecture-reviewer` (strict) vs `architecture-reviewer-lite`

Recorded 2026-10-07. Raw series live in `results/repeat-{strict,lite}.json` (git-ignored); this note is the
committed copy of the numbers.

## Setup

| | |
|---|---|
| A (`--label strict`) | `.claude/agents/architecture-reviewer.md` — **Rule** cell mandatory for every finding |
| B (`--label lite`) | `.claude/agents/architecture-reviewer-lite.md` — identical, but no Rule column / no citation duty |
| Cases | the same 4 cases (`agents/architecture-reviewer/architecture-reviewer.cases.ts`), 19 judged practices |
| Agent model | `deepseek/deepseek-v4-flash` (OpenRouter via the LiteLLM proxy) — the cheapest model that runs the tool tier |
| Judge model | `google/gemini-2.5-flash` (different family from the agent) |
| Series | `pnpm eval:repeat agents/<name> -n 2 --label <label>` (`-n 2` is the repo's token-economy cap) |
| Compare | `pnpm eval:delta strict lite` |

Total spend: 16 agent sessions (4 cases × 2 runs × 2 agents) plus judge calls, all on flash-tier models.

## Result (practice pass rate over 2 runs, strict → lite)

```
A = strict  sha 708a32a-dirty  (2 runs)
B = lite  sha 708a32a-dirty  (2 runs)

   50% ->  50%  Δ    0  cites the DevDigest-specific rule identifier for reviewer-core violations
      100% -> 100%  Δ    0  flags the `import { readFileSync } from 'node:fs'` added to reviewe…
       50% ->  50%  Δ    0  flags that runPipeline now returns `deduped` directly, skipping the…
      100% -> 100%  Δ    0  names the exact rule `reviewer-core-stays-pure` for the fs-import f…
       50% ->  50%  Δ    0  ties the skipped-`groundFindings()` finding to a documented rule (g…
      100% -> 100%  Δ    0  cites a file:line range inside the changed hunk for each finding
      100% -> 100%  Δ    0  assigns each finding one of the severities CRITICAL, WARNING or SUG…
      tok_out : 8369 -> 11215  (+2846)
      turns   : 27 -> 35  (+9)
      duration: 125845 -> 383259  (+257415)

  100% -> 100%  Δ    0  does not fabricate a documented-rule violation for a benign rename
      100% -> 100%  Δ    0  reports no findings for the benign rename (an empty findings list /…
      100% -> 100%  Δ    0  does not fabricate a documented-rule violation, nor a SUGGESTION ab…
      tok_out : 8436 -> 5386  (-3050)
      turns   : 31 -> 22  (-9)
      duration: 183713 -> 165849  (-17864)

  100% -> 100%  Δ    0  does not fabricate an architecture finding for the out-of-scope security-shaped change
      100% -> 100%  Δ    0  treats the optional `reply?: FastifyReply` parameter only as a laye…
      100% -> 100%  Δ    0  stays scoped to layering/dependency-direction/DI findings and does …
      tok_out : 5576 -> 6496  (+920)
      turns   : 22 -> 16  (-6)
      duration: 165189 -> 124462  (-40727)

  100% -> 100%  Δ    0  flags both violations in the checkout diff with severity and a citable rule
      100% -> 100%  Δ    0  flags the domain file (checkout.ts) importing a type from 'fastify'…
      100% ->  50%  Δ  -50  flags the `new PgCheckoutRepository()` call inside service.ts as a …
      100% -> 100%  Δ    0  names a specific documented rule for EVERY finding (a depcruise rul…
      100% -> 100%  Δ    0  assigns each finding one of the severities CRITICAL, WARNING or SUG…
      100% -> 100%  Δ    0  cites a file:line range inside the changed hunk for each finding
      100% -> 100%  Δ    0  hands back findings only: it does not compute a numeric score or de…
      tok_out : 8575 -> 9064  (+489)
      turns   : 22 -> 25  (+3)
      duration: 215268 -> 231237  (+15969)
```

## Reading it

- **Spread is visible, not noise-free.** With n=2 a practice can only be 0/50/100 %. Two practices sit at 50 %
  in *both* arms (`groundFindings()` skipped-gate flagged / tied to a rule), so that is run-to-run variance of
  the cheap model, not an effect of the edit.
- **The one Δ is −50 %** (lite stops flagging `new PgCheckoutRepository()` in one of two runs). One run of
  difference — consistent with noise, **not** evidence that dropping the citation duty hurts recall.
- **The citation rule did not discriminate on this model.** Lite still named a rule in 2/2 runs. The hypothesis
  "strict cites rules, lite only paraphrases" is not supported at this sample size; a stronger signal needs more
  runs (`-n` is capped at 2) or a harsher fixture.
- **Cost differs more than quality**: lite ran 35 vs 27 turns and 383 s vs 126 s on the reviewer-core case,
  but fewer turns on two others — again variance-dominated, so no cost conclusion either.

## Why the cases were rewritten first

The old shared cases were written for an earlier catalogue-style agent (`RULE: reviewer-core-zero-io`,
critical/high/medium severities, a PASS/FAIL verdict). The current agent emits CRITICAL/WARNING/SUGGESTION, takes
rule names from `server/.dependency-cruiser.cjs` and never emits a verdict, so those cases could not pass (the
architecture-reviewer cases were 0/1 on most earlier runs). Practices now follow the current agent contract.

`eval:delta` now pairs tests by case name rather than full nodeid, otherwise an A/B of two *different* artifacts
(different `describe`/file prefix) showed `—` on every row.
