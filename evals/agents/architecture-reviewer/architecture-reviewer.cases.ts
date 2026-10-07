import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-stays-pure` from server/.dependency-cruiser.cjs, and the mandatory grounding gate
// from CLAUDE.md) that a competent model will describe in prose but will not spontaneously name
// unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (whose Rule cell is mandatory) should reliably emit the identifier.
// The checkout diff's textbook violations discriminate less — the model volunteers the layer
// name either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "names the documented rule" keeps passing.
// Practices follow the CURRENT agent contract (.claude/agents/architecture-reviewer.md): severity
// CRITICAL/WARNING/SUGGESTION, a Rule cell per finding, file:line citations, no score or verdict.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation: Fastify may only be named at the HTTP edge, and the domain layer must not depend on it",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of dependency-injection discipline (concrete repositories/adapters are constructed only in the composition root / Container, not inside a service)",
      "names a specific documented rule for EVERY finding (a depcruise rule name such as `no-fastify-outside-edge`, or an onion-architecture SKILL.md / CLAUDE.md rule) rather than describing the problem only in prose",
      "assigns each finding one of the severities CRITICAL, WARNING or SUGGESTION",
      "cites a file:line range inside the changed hunk for each finding",
      "hands back findings only: it does not compute a numeric score or declare a PASS/FAIL verdict for the change",
    ],
    threshold: 0.7, // ≥5 of 6 practices: the format-strict ones (rule name, line range) flake on cheap models
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "treats the optional `reply?: FastifyReply` parameter only as a layering problem (the Fastify import in the domain layer); it does not report it as a runtime bug, unused-parameter defect or security issue",
      "stays scoped to layering/dependency-direction/DI findings and does not comment on naming, style, test coverage, correctness or security",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "names the exact rule `reviewer-core-stays-pure` for the fs-import finding rather than only describing it in prose",
      "ties the skipped-`groundFindings()` finding to a documented rule (grounding is mandatory — a finding without a real diff-line citation is dropped) rather than only describing it in prose",
      "cites a file:line range inside the changed hunk for each finding",
      "assigns each finding one of the severities CRITICAL, WARNING or SUGGESTION",
    ],
    threshold: 0.7, // ≥5 of 6 practices: the exact-rule-name ones flake on cheap models
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no findings for the benign rename (an empty findings list / 'No findings') — it does not invent a CRITICAL or WARNING finding",
      "does not fabricate a documented-rule violation, nor a SUGGESTION about naming or style, where the diff violates no layering rule",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
