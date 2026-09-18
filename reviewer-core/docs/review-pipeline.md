# Review pipeline

The single-pass flow this package runs for one agent, one PR, one diff
(`src/review/run.ts` orchestrates the steps below; each step is independently
importable from `src/index.ts`).

```
diff (UnifiedDiff, from @devdigest/shared)
  │
  ▼
assemblePrompt()          src/prompt.ts
  — system + user messages; wraps any untrusted repo content in
    wrapUntrusted() and appends the single INJECTION_GUARD text.
    Optional slots (skills / memory / specs / callers) are simply
    omitted in the starter — never stubbed with empty values.
  │
  ▼
LLMProvider.complete()    src/llm/ (openrouter.ts is the shipped impl)
  — structured.ts turns the target zod schema into a JSON Schema for
    the call, then parses the response with repair-on-malformed-JSON.
  │
  ▼
raw Finding[] (model output, NOT yet trusted)
  │
  ▼
groundFindings()          src/grounding.ts
  — the mandatory citation gate; see specs/grounding.md.
  │
  ▼
kept Finding[] + dropped[] (with reasons, for the trace)
  │
  ▼
score recomputed from kept findings only
  — the model's self-reported score is discarded unconditionally.
```

## Why this package has no DB/GitHub/filesystem access

Every external effect this pipeline needs (the diff, prior findings, repo
context) arrives as data through `run()`'s arguments, and the only IO it
performs itself is the LLM call — through the injected `LLMProvider`. That
makes the whole pipeline testable with a stubbed provider and zero network
(`npm test`), and keeps `server` the single place that decides how to fetch
a diff or persist a finding.

## Contracts live elsewhere

`Review`, `Finding`, `Verdict`, `UnifiedDiff` are all defined in
`@devdigest/shared` (vendored into `server/src/vendor/shared`), not in this
package — `src/index.ts` re-exports the pipeline functions but never
redefines their types.
