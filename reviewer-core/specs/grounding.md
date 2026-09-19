# Spec — grounding (the mandatory citation gate)

`groundFindings()` (`src/grounding.ts`) decides which of a review's raw
findings are trustworthy enough to keep. This is not optional or
configurable per agent — every finding from every reviewer passes through
it before it reaches storage or the client.

## Rule

A finding is **kept** only if:

- its `file` is one of the files present in the PR's unified diff, **and**
- for an ordinary diff-scoped finding: its `[start_line, end_line]` range
  intersects a real hunk in that file's diff (`buildLineIndex` maps each
  file to the set of new-side line numbers its hunks actually cover).

A finding is **exempted from the line-range check** (but still needs its
file to be in the diff) when its `kind` is one of `secret_leak`,
`lethal_trifecta`, `phantom`, or `hook` — these come from full-file
scanners, not a diff-hunk-scoped read, so they never carry a line range that
would intersect a hunk.

A finding is **dropped** — never surfaced anywhere — when either check
fails, with a human-readable reason attached for the trace
(`GroundingResult.dropped`):

- `` `file '<path>' not present in diff` `` — the model hallucinated a file.
- `` `lines <a>-<b> do not intersect any diff hunk in '<path>'` `` — the
  model cited a real file but the wrong location in it.

## Score recompute

After grounding, the review's score is **always** recomputed from `kept`
findings only — the model's self-reported score in its raw output is
discarded unconditionally, never trusted or passed through
(`server/CLAUDE.md`'s Gotchas repeats this same rule from the consumer
side). This means a model that over- or under-reports its own findings
cannot skew the score by lying about severity counts; it can only affect the
score by what it actually cites correctly.

## What this spec deliberately does not cover

- How `kept`/`dropped` are surfaced in the UI (Trace drawer — see
  `client/docs/`) — this package only produces the data.
- Per-agent grounding overrides — there are none; the gate is uniform.
