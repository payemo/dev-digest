# Repo-wide insight highlights

Condensed from the root and package `INSIGHTS.md` files, for a reviewing
agent's context — not a replacement for them. Each package's own
`INSIGHTS.md` (`client`, `server`, `reviewer-core`, `e2e`, `mcp`) is the
authoritative, up-to-date source.

- **Grounding is mandatory.** A finding without a real diff-line citation is
  dropped and the score is recomputed from the survivors — the model's own
  self-reported score is never trusted.
- **Migrations never run on boot.** After a schema change or a fresh DB, run
  `cd server && pnpm db:migrate` explicitly; nothing applies a pending
  migration automatically.
- **Secrets live in `~/.devdigest/secrets.json`** (mode `0600`), with
  `process.env` as fallback — never in `AppConfig`, the DB, or git. Pointing a
  feature's default provider at one the test suite doesn't mock turns the
  hermetic test lane into a live, billed one.
- **The skills prompt slot is trusted, unwrapped instructions** — unlike every
  other external input. A skill may only contribute *which* documents enter a
  run's context, never inline their text, or repo-authored Markdown would
  reach the model as trusted instructions.
- **GitHub Actions `paths:` filters apply in order** — `!**/INSIGHTS.md` must
  stay last, and `paths` + `paths-ignore` cannot both appear on one event.
