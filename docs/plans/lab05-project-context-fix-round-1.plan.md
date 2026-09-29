# Fix Plan — round 1 (`lab05-project-context`)

**Source plan:** [`lab05-project-context.plan.md`](lab05-project-context.plan.md)
**Trigger:** `security-reviewer` findings on the S16/S29 pass (2026-09-29), both WARNING.
**Execution mode:** single agent — `implementer`.

Two findings, filtered from the review's full table
(`CRITICAL`/`WARNING` only — the review's one `SUGGESTION`, an unscoped
`agentId`/`skillId` owner check on the attachment routes, is carried into the
final summary as a non-blocking note, not fixed here).

## Step 1 — Close the symlinked-category-directory escape in the doc scanner

**Files:** `server/src/adapters/docsource/clone.ts:60-74,118-147`
(`scan()` and `collect()`), and add one constant to
`server/src/modules/project-context/constants.ts` if a walk-entry cap needs a
name.

**Finding:** `collect()` checks `entry.isSymbolicLink()` only for entries
*inside* a directory it is already reading — it never checks whether the
`dir` it was handed (a category directory, or `root` itself) is itself a
symlink before calling `readdir` on it. The file's own doc comment at
`clone.ts:121-124` claims a symlinked category directory is blocked; it is
not. A malicious repo can commit `.devdigest/docs` as a relative symlink
pointing outside the clone (e.g. `../../../../../../..`); `readdir` follows
it, the walk recurses through real directories there, and every `*.md`
under it — up to `MAX_DOCS_PER_REPO`, each up to `MAX_DOC_BYTES` — is read
and stored as an `origin: 'repo'` document, then shown in the UI, attachable,
and sendable to the external model. The same gap allows an unbounded walk
before `MAX_DOCS_PER_REPO` is applied, if the symlink target is large.

**Change:** address the finding directly —

1. `lstat` (never `stat`) the convention root and each category directory
   before reading them. If either is a symlink, or not a directory, treat it
   as absent — same "contributes nothing" behavior the code already has for
   a missing category, not a hard failure of the whole scan.
2. Thread a resolved, symlink-free base path (`realpath(clonePath)`) through
   `collect()`, and before a candidate file is added to `out`, resolve its
   real path and require it fall under that base — the second, independent
   layer the finding recommends ("realpath each candidate ... before
   stat/readFile"), not a replacement for step 1.
3. Bound the number of directory entries `collect()` will visit across the
   whole walk (files and directories both), not only the post-walk
   `MAX_DOCS_PER_REPO` cap on kept documents — so a symlink into a very large
   tree cannot turn one Refresh into an unbounded directory walk. A single
   shared counter threaded through the recursion, bailing once it crosses a
   generous fixed bound, is enough; this is a DoS bound, not a correctness
   change to which files are found under a normal-sized repo.
4. Update the doc comment at `clone.ts:118-124` to describe what the code
   now actually does — it currently asserts a protection this diff is
   fixing, and a stale comment asserting a fix that isn't there is exactly
   how this gap got introduced.

**Constraint:** `specs/02-project-context.md` NFR-2 ("A document's content
must not be able to break out of its delimiter block, and a document
supplied by upload must not be able to address a location outside its
repository's document area" — the scan side of that same boundary) and plan
step S16's own "symlinked category directory" line
(`lab05-project-context.plan.md:637`), which this closes for real.

**Done when:** `security-reviewer` re-scans this file and no longer reports
a symlink-escape finding on it; the existing hermetic doc-source tests (and
any the reviewer's re-scan exercises) still pass with a plain,
non-symlinked fixture tree.

## Step 2 — Harden `wrapUntrusted`'s delimiter-breakout resistance for every untrusted slot

**Files:** `reviewer-core/src/prompt.ts:30-34` (the `wrapUntrusted` function
itself — **not** a project-context-specific wrapper or denylist).

**Finding:** `wrapUntrusted` neutralizes only the exact lowercase literal
`</untrusted>`. It was written when the only untrusted content was diff text
and PR prose; this feature adds a channel — an uploaded document's body — 
where the *author of the untrusted content* is the attacker, more directly
than "code that happens to live in a reviewed repo." Case variants
(`</UNTRUSTED>`), whitespace-inserted variants (`</ untrusted>`,
`</untrusted\n>`), and a forged opening tag (`<untrusted source="spec-9">`)
all pass through unneutralized today, and a model does not parse the
delimiter as strict XML, so any of these can plausibly read as "the
untrusted block ended here."

**Change:** address the finding directly, in `wrapUntrusted` itself so every
untrusted slot — diff, PR description, derived intent, repo-map, callers,
and now specs — gets the same hardening, per `server/CLAUDE.md`'s
grounding-not-pattern-matching stance (fixing this per-slot instead of at the
one shared function would be exactly the "denylist bolted onto one call
site" pattern that stance rules out). Replace the single literal-string
`replaceAll` with a case-insensitive match on any `<`, optional `/`,
optional whitespace, then the word `untrusted` — covering both the closing
tag and a forged opening tag, in any case, with or without inserted
whitespace — and neutralize each match the same way the current code already
does for the one case it covers (break the token, don't delete it, so the
untrusted text is still visible in the trace verbatim, just inert as a
delimiter). Keep the function's own output — the literal
`<untrusted source="${label}">...</untrusted>` wrapper it produces — 
byte-identical to today, so nothing downstream that reads
`assembly.specs`/`assembly.user` for the trace, or any existing test
asserting on that literal wrapper text, needs to change; only content
*inside* the wrapper that tries to mimic the wrapper gets touched.

**Constraint:** `specs/02-project-context.md` NFR-1/NFR-2 (untrusted data
must not break out of its delimiter block) and the security review's
explicit instruction that any fix "must land in `wrapUntrusted` itself for
all untrusted slots, never as a project-context-specific denylist."

**Done when:** `security-reviewer` re-scans `reviewer-core/src/prompt.ts`
and no longer reports the delimiter-breakout finding; `reviewer-core`'s
existing prompt-assembly tests still pass unchanged (the wrapper's visible
output format is unchanged), and a case/whitespace-variant breakout attempt
in a spec body is confirmed still inert.

## Out of scope for this round

- The review's `SUGGESTION` (unscoped `agentId`/`skillId` ownership check on
  the attachment routes) — carried forward as a non-blocking note, not fixed
  here; it is not exploitable under the current single-workspace local-auth
  provider, only inconsistent with the module's other scope checks.
- Anything the `architecture-reviewer` pass covered — it returned no
  findings.
