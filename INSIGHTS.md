# Insights — DevDigest (cross-cutting)

Findings that **no single package owns** — `scripts/`, `docker-compose.yml`,
`.github/workflows/`, `.claude/`, root docs. Anything a package owns belongs in
that package's `INSIGHTS.md`
([client](client/INSIGHTS.md) · [server](server/INSIGHTS.md) ·
[reviewer-core](reviewer-core/INSIGHTS.md) · [e2e](e2e/INSIGHTS.md)), not here.

**Budget: 15 entries, 2 lines each.** At the cap, a new entry earns its place by
displacing a stale one or promoting one into a package file — never by growing
the list. Sections appear only once they have an entry. Format and rules:
[`.claude/skills/engineering-insights`](.claude/skills/engineering-insights/SKILL.md).

## Tool & Library Notes

### 2026-09-16 — `!**/INSIGHTS.md` must stay **last** in every workflow `paths:` list

GitHub applies `paths` patterns in order, so moving that exclusion above an
inclusion silently undoes it, and `paths` + `paths-ignore` cannot both appear on
one event — the `!` form is the only option.
Evidence: `.github/workflows/server-unit.yml:23`.

### 2026-09-20 — An apostrophe inside a single-quoted `node -e` block silently rewrites the program

Bash single quotes have no escape, so a `\'` in an embedded JS comment ends the
quote instead of escaping it — the hook still passed `bash -n` and denied every
Bash call in the session. Keep `.claude/hooks/**` node blocks apostrophe-free.
Evidence: `.claude/hooks/pr-self-review-gate.sh:108`.
