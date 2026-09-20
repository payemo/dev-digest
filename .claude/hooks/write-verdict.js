#!/usr/bin/env node
// Deterministic verdict writer for pr-self-review.
//
// The skill hands this script *only* findings (plus phase0 results, the list
// of skills that ran, and uncovered_files) as JSON on stdin. Score, verdict,
// blocked and state_key are computed HERE, not by the model — the same
// separation the product itself uses: reviewer-core/src/review/reduce.ts
// recomputes `score` from `findings` and never trusts the model's own number
// (see docs/agent-prompts/README.md, "Severity / verdict / gate at a glance").
// A model that can miscount CRITICALs must not also be the one deciding
// whether the PR is blocked.
//
// Usage: node write-verdict.js <outDir> <baseSha> <headSha> <stateKey> <generatedAt>
//        findings JSON on stdin — see .claude/skills/pr-self-review/SKILL.md
//        for the exact input shape.
//
// A file with an apostrophe-free style on purpose: see the 2026-09-20 entry
// in the root INSIGHTS.md about an escaped apostrophe silently corrupting a
// single-quoted `node -e` block in this hook's shell script. Keeping this
// logic in its own .js file (no shell quoting at all) is the fix, not a
// convention to maintain by hand inside gate.sh.

'use strict';
const fs = require('fs');

const [outDir, baseSha, headSha, stateKey, generatedAt] = process.argv.slice(2);
if (!outDir || !stateKey) {
  process.stderr.write('write-verdict: usage: write-verdict.js <outDir> <baseSha> <headSha> <stateKey> <generatedAt>\n');
  process.exit(2);
}

const SEVERITIES = new Set(['CRITICAL', 'WARNING', 'SUGGESTION']);
const CATEGORIES = new Set(['bug', 'security', 'perf', 'style', 'test']);
const REQUIRED_FIELDS = ['severity', 'title', 'file', 'start_line', 'end_line', 'rationale'];

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    process.stderr.write('write-verdict: stdin is not valid JSON: ' + err.message + '\n');
    process.exit(1);
  }

  const findings = Array.isArray(input.findings) ? input.findings : [];
  const phase0 = Array.isArray(input.phase0) ? input.phase0 : [];
  const skillsRun = Array.isArray(input.skills_run) ? input.skills_run : [];
  const uncoveredFiles = Array.isArray(input.uncovered_files) ? input.uncovered_files : [];

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    for (const field of REQUIRED_FIELDS) {
      if (f[field] === undefined || f[field] === null || f[field] === '') {
        process.stderr.write('write-verdict: findings[' + i + '] is missing required field "' + field + '"\n');
        process.exit(1);
      }
    }
    if (!SEVERITIES.has(f.severity)) {
      process.stderr.write('write-verdict: findings[' + i + '].severity "' + f.severity + '" is not CRITICAL, WARNING or SUGGESTION\n');
      process.exit(1);
    }
    if (f.category !== undefined && f.category !== null && !CATEGORIES.has(f.category)) {
      process.stderr.write('write-verdict: findings[' + i + '].category "' + f.category + '" is not bug, security, perf, style or test\n');
      process.exit(1);
    }
  }

  const counts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) counts[f.severity] += 1;

  // Same weights as reviewer-core/src/review/reduce.ts: score is a function
  // of findings, full stop. Never accept a pre-computed score from the input.
  const score = Math.max(0, 100 - 35 * counts.CRITICAL - 12 * counts.WARNING - 3 * counts.SUGGESTION);
  const phase0Failed = phase0.some((p) => p.status !== 'pass');
  const blocked = counts.CRITICAL > 0 || phase0Failed;
  // A failing phase0 command (a typecheck that doesn't compile, a layering
  // check that fails) is exactly the shape of thing that requests changes,
  // even with zero LLM findings — `blocked: true, verdict: "approve"` would
  // be self-contradictory and the hook's deny reason would have nothing to
  // point at.
  const verdict = (counts.CRITICAL > 0 || phase0Failed)
    ? 'request_changes'
    : (findings.length > 0 ? 'comment' : 'approve');

  const verdictDoc = {
    generated_at: generatedAt,
    base_sha: baseSha,
    head_sha: headSha,
    state_key: stateKey,
    verdict,
    score,
    blocked,
    phase0,
    skills_run: skillsRun,
    uncovered_files: uncoveredFiles,
    findings,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outDir + '/verdict.json', JSON.stringify(verdictDoc, null, 2) + '\n');
  fs.writeFileSync(outDir + '/report.md', renderReport(verdictDoc, counts));

  process.stdout.write(
    'write-verdict: wrote ' + outDir + '/verdict.json and ' + outDir + '/report.md\n' +
    'verdict=' + verdict + ' score=' + score + ' blocked=' + blocked +
    ' critical=' + counts.CRITICAL + ' warning=' + counts.WARNING + ' suggestion=' + counts.SUGGESTION + '\n'
  );
});

function renderReport(doc, counts) {
  const lines = [];
  lines.push('# pr-self-review — ' + doc.verdict + (doc.blocked ? ' (BLOCKED)' : ''));
  lines.push('');
  lines.push(
    'Score: **' + doc.score + '**/100 · CRITICAL ' + counts.CRITICAL +
    ' · WARNING ' + counts.WARNING + ' · SUGGESTION ' + counts.SUGGESTION
  );
  lines.push('Base: `' + doc.base_sha + '` · Head: `' + doc.head_sha + '` · Generated: ' + doc.generated_at);
  lines.push('');

  if (doc.phase0.length) {
    lines.push('## Phase 0 — deterministic checks');
    lines.push('');
    for (const p of doc.phase0) {
      const mark = p.status === 'pass' ? 'PASS' : 'FAIL';
      lines.push('- [' + mark + '] ' + p.check + (p.detail ? ' — ' + p.detail : ''));
    }
    lines.push('');
  }

  const bySeverity = (sev) => doc.findings.filter((f) => f.severity === sev);
  const renderFinding = (f) => {
    const range = f.end_line !== f.start_line ? (f.start_line + '-' + f.end_line) : String(f.start_line);
    const who = f.skill || f.category || 'rule';
    let block = '- **' + f.title + '** — `' + f.file + ':' + range + '` (' + who + ')\n  ' + f.rationale;
    if (f.suggestion) block += '\n  Suggestion: ' + f.suggestion;
    return block;
  };

  const sections = [
    ['CRITICAL', 'CRITICAL'],
    ['Warnings', 'WARNING'],
    ['Suggestions', 'SUGGESTION'],
  ];
  for (const [label, sev] of sections) {
    const items = bySeverity(sev);
    if (!items.length) continue;
    lines.push('## ' + label + ' (' + items.length + ')');
    lines.push('');
    for (const f of items) lines.push(renderFinding(f));
    lines.push('');
  }
  if (!doc.findings.length) {
    lines.push('No findings.');
    lines.push('');
  }

  lines.push('## Skills run');
  lines.push('');
  lines.push(doc.skills_run.length
    ? doc.skills_run.map((s) => '- ' + s).join('\n')
    : '- (none — no file in the diff matched a routed skill)');
  lines.push('');

  if (doc.uncovered_files.length) {
    lines.push('## Uncovered files (repo-rules only, no skill lane)');
    lines.push('');
    lines.push(doc.uncovered_files.map((f) => '- `' + f + '`').join('\n'));
    lines.push('');
  }

  return lines.join('\n');
}
