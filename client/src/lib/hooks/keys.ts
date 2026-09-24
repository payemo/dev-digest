/**
 * Query-key factory for the reviews/runs domain (src/lib/hooks/reviews.ts).
 * These keys used to be duplicated as raw string arrays outside this file —
 * `pulls/[number]/page.tsx` hand-built `["pr-active-runs", prId]` to
 * invalidate a query the hooks below already knew how to invalidate, and the
 * two copies could (and did) drift: `useRunReview` invalidated `reviews` but
 * not `pr-active-runs`/`pr-runs`, so a page-level component had to know and
 * duplicate those key strings itself. Building every key through one factory
 * means there is exactly one place to get it right.
 */
export const reviewKeys = {
  activeRuns: (prId: string | null | undefined) => ["pr-active-runs", prId] as const,
  runs: (prId: string | null | undefined) => ["pr-runs", prId] as const,
  reviews: (prId: string | null | undefined) => ["reviews", prId] as const,
  comments: (prId: string | null | undefined) => ["pr-comments", prId] as const,
  intent: (prId: string | null | undefined) => ["pr-intent", prId] as const,
};

/**
 * Query-key factory for the skills domain (src/lib/hooks/skills.ts). Every
 * skills-related key goes through this, same rationale as `reviewKeys` above:
 * one place to get invalidation right.
 */
export const skillKeys = {
  all: () => ["skills"] as const,
  detail: (id: string | null | undefined) => ["skill", id] as const,
  versions: (id: string | null | undefined) => ["skill-versions", id] as const,
  stats: (id: string | null | undefined) => ["skill-stats", id] as const,
  agents: (id: string | null | undefined) => ["skill-agents", id] as const,
};

/**
 * Query key for an agent's linked skills (`GET /agents/:id/skills`). Lives
 * next to `skillKeys` rather than inside it because it's keyed by agent, not
 * by skill — but it moves the same data, so agent-skill mutations invalidate
 * both factories together (see hooks/agents.ts's `useSetAgentSkills`).
 */
export const agentSkillKeys = {
  forAgent: (agentId: string | null | undefined) => ["agent-skills", agentId] as const,
};

/**
 * Query-key factory for the Conventions Extractor (src/lib/hooks/conventions.ts).
 * Keyed by repo — a scan, an accept/reject/edit, and a skill-draft fetch all
 * invalidate through `forRepo`.
 */
export const conventionKeys = {
  forRepo: (repoId: string | null | undefined) => ["conventions", repoId] as const,
  draft: (repoId: string | null | undefined) => ["conventions-skill-draft", repoId] as const,
};
