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
};
