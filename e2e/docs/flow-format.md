# Flow file format

A flow is `specs/NN-name.flow.json` — a JSON object with a `name`, a prose
`description` (what it proves, what it assumes, any known constraint), and a
`steps` array. `run.ts` plays the steps in order against one shared browser
session driven by [agent-browser](https://github.com/vercel-labs/agent-browser).

```json
{
  "name": "Short, specific title",
  "description": "What this proves, what it assumes about seed state, how to run it locally.",
  "steps": [
    { "cmd": ["open", "{BASE}/"], "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"], "label": "land on the PR list" },
    { "cmd": ["find", "text", "some visible string", "click"], "label": "click it" },
    { "cmd": ["find", "role", "button", "click", "--name", "Agent runs"], "label": "click a named role" },
    { "cmd": ["wait", "--text", "some text that must now be visible"], "label": "assert it rendered" }
  ]
}
```

Each step is `{ cmd: string[], label: string }` — `label` is what shows up
in failure output, so it should read as an assertion or an action, not a
restatement of the command. `{BASE}` is substituted with the running stack's
base URL by `run.ts`.

## Locators are deterministic only

`--url`, `--text`, `find role|text|label` — never the AI `chat` command.
`chat` would make a run non-deterministic and require an API key, which
breaks the "no LLM call, no key" guarantee every flow makes.

## Hermetic vs. local runs

- `npm test` (`tsx run.ts`) plays every flow in `specs/` against **your own
  already-running dev stack** — only safe when that DB's only repo is the
  seeded demo repo (`acme/payments-api`), since flows assume PR #482 and its
  seeded review are the first/only ones (see `e2e/CLAUDE.md`'s Gotchas).
- `npm run e2e:hermetic` (`../scripts/e2e.sh`) boots an isolated,
  freshly-seeded stack on alternate ports and tears it down after — this is
  what CI runs, and the preferred way to run locally too, since it can't be
  polluted by other imported repos.

## Numbering

The `NN-` prefix is a suggested run order, not an id anything references —
new flows get the next free number and don't need to slot in between
existing ones.
