#!/usr/bin/env bash
# PR self-review gate.
#
# Hook mode (no args, PreToolUse JSON on stdin): denies `gh pr create` unless a
# fresh, unblocked verdict from the pr-self-review skill exists.
#
#   --print-base   merge-base sha the review scope is measured from
#   --print-key    state key of the current scope; the skill stores it in
#                  verdict.json and this script recomputes it to detect staleness
#   --check        human/CI mode: 0 = clear, 1 = blocked, 2 = missing or stale
#
# The skill MUST take its state_key from --print-key: one function, one
# definition of "the working tree has moved since the review".
set -uo pipefail

VERDICT_FILE=".claude/.cache/pr-self-review/verdict.json"

# This hook is attached to every Bash call, so nothing above the prefilter in
# hook mode may spawn a process. Resolving the repo root is deferred until a
# mode actually needs it.
init_root() {
  ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
  [ -n "$ROOT" ] || exit 0
  cd "$ROOT" 2>/dev/null || exit 0
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  else shasum -a 256 | cut -d' ' -f1; fi
}

base_sha() {
  local ref
  for ref in origin/main main origin/master master; do
    if git rev-parse --verify -q "$ref" >/dev/null 2>&1; then
      git merge-base "$ref" HEAD 2>/dev/null && return 0
    fi
  done
  git rev-parse HEAD 2>/dev/null   # no base branch: only uncommitted work is in scope
}

# Content of the review scope, invariant to committing it: the same worktree
# hashes the same whether the changes are staged, unstaged, or already
# committed on the branch. Untracked files are included — they are reviewed,
# so they must invalidate the verdict too.
state_key() {
  local base
  base="$(base_sha)"
  {
    printf 'base:%s\n' "$base"
    git diff "$base" 2>/dev/null
    git ls-files --others --exclude-standard | LC_ALL=C sort | while IFS= read -r f; do
      [ -f "$f" ] || continue
      printf 'untracked:%s:' "$f"
      sha256 < "$f"
    done
  } | sha256
}

case "${1:-}" in
  --print-base) init_root; base_sha; exit 0 ;;
  --print-key)  init_root; state_key; exit 0 ;;
esac

# status: prints "ok" | "missing" | "stale" | "blocked<TAB>reason"
gate_status() {
  [ -f "$VERDICT_FILE" ] || { echo missing; return; }
  KEY="$(state_key)" node -e '
    const fs = require("fs");
    let v;
    try { v = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { console.log("stale"); process.exit(0); }
    if (!v.state_key || v.state_key !== process.env.KEY) { console.log("stale"); process.exit(0); }
    const crit = (v.findings || []).filter(f => f.severity === "CRITICAL");
    const failedChecks = (v.phase0 || []).filter(p => p.status !== "pass");
    if (v.blocked === true || crit.length > 0 || failedChecks.length > 0) {
      const parts = [];
      if (failedChecks.length) {
        parts.push(`${failedChecks.length} phase-0 check(s) failed:`);
        for (const p of failedChecks.slice(0, 10)) {
          parts.push(`  • ${p.check}${p.detail ? " — " + p.detail : ""}`);
        }
      }
      if (crit.length) {
        parts.push(`${crit.length} CRITICAL finding(s), score ${v.score ?? "?"}:`);
        for (const f of crit.slice(0, 10)) {
          parts.push(`  • [${f.skill || f.category || "rule"}] ${f.title} — ${f.file}:${f.start_line}`);
        }
        if (crit.length > 10) parts.push(`  …and ${crit.length - 10} more`);
      }
      if (!parts.length) parts.push(`blocked (score ${v.score ?? "?"})`);
      console.log("blocked\t" + parts.join("\n"));
      process.exit(0);
    }
    console.log("ok");
  ' "$VERDICT_FILE" 2>/dev/null || echo stale
}

if [ "${1:-}" = "--check" ]; then
  init_root
  s="$(gate_status)"
  case "${s%%$'\t'*}" in
    ok)      echo "pr-self-review: clear" >&2; exit 0 ;;
    blocked) printf 'pr-self-review: BLOCKED\n%s\n' "${s#*$'\t'}" >&2; exit 1 ;;
    stale)   echo "pr-self-review: verdict is stale — re-run /pr-self-review" >&2; exit 2 ;;
    *)       echo "pr-self-review: no verdict — run /pr-self-review" >&2; exit 2 ;;
  esac
fi

# --write-verdict: the skill's only way to produce verdict.json/report.md.
# It hands findings (+ phase0/skills_run/uncovered_files) as JSON on stdin;
# score, verdict, blocked and state_key are computed by write-verdict.js, not
# by the model that found them — see that file's header for why.
if [ "${1:-}" = "--write-verdict" ]; then
  init_root
  OUT_DIR=".claude/.cache/pr-self-review"
  node "$ROOT/.claude/hooks/write-verdict.js" \
    "$OUT_DIR" "$(base_sha)" "$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
    "$(state_key)" "$(date -u +%FT%TZ)"
  exit $?
fi

# ---- hook mode ----
# Cheap, process-free superset of the regex below: almost every Bash call in a
# session is rejected here, before node or git is ever started.
PAYLOAD="$(cat)"
[[ "$PAYLOAD" == *gh*pr*create* ]] || exit 0
init_root

COMMAND="$(printf '%s' "$PAYLOAD" | node -e '
  let d = "";
  // Match only at a command position, so a command that merely MENTIONS the
  // phrase (an echo, a grep, a heredoc, a doc example) is not gated.
  process.stdin.on("data", c => d += c).on("end", () => {
    let j; try { j = JSON.parse(d); } catch { process.exit(3); }
    const t = j.tool_name || "";
    const c = (j.tool_input && j.tool_input.command) || "";
    const INVOKE = /(?:^|[;&|(\n])[ \t]*(?:env[ \t]+)?(?:[A-Za-z_][A-Za-z0-9_]*=[^ \t]*[ \t]+)*gh[ \t]+pr[ \t]+create(?:[ \t]|$)/;
    if (t !== "Bash" || !INVOKE.test(c)) process.exit(3);
    process.stdout.write(c);
  });
' 2>/dev/null)" || exit 0
[ -n "$COMMAND" ] || exit 0

deny() {
  REASON="$1" node -e 'process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: process.env.REASON,
    },
  }))'
  exit 0
}

# Deliberate, user-invoked escape hatch — recorded, never silent.
if [ "${PR_SELF_REVIEW_BYPASS:-}" = "1" ] || [[ "$COMMAND" == *"PR_SELF_REVIEW_BYPASS=1"* ]]; then
  mkdir -p .claude/.cache/pr-self-review
  printf '%s\tbypass\t%s\n' "$(date -u +%FT%TZ)" "$COMMAND" \
    >> .claude/.cache/pr-self-review/bypass.log
  exit 0
fi

STATUS="$(gate_status)"
case "${STATUS%%$'\t'*}" in
  ok) exit 0 ;;
  blocked)
    deny "PR blocked by pr-self-review.

${STATUS#*$'\t'}

Fix the CRITICAL findings, then re-run /pr-self-review. Full report:
.claude/.cache/pr-self-review/report.md
Opening the PR anyway is the user's call, not yours: they can re-run with
PR_SELF_REVIEW_BYPASS=1 prefixed to the command." ;;
  stale)
    deny "The pr-self-review verdict is stale — the working tree changed after it was written. Run /pr-self-review, then retry this command unchanged." ;;
  *)
    deny "No pr-self-review verdict for these changes. Run /pr-self-review first, then retry this command unchanged." ;;
esac
