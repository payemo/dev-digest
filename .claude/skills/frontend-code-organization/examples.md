# Examples — placement decisions in `client/src`

Every example below is anchored to a real path. Where the repo itself deviates
from the rule, that is called out rather than hidden — those are the two known
drift spots, not patterns to copy.

---

## 1. Choosing a tier for a new component

**Scenario:** a severity filter dropdown for the PR detail page.

```
✅ src/app/repos/[repoId]/pulls/[number]/_components/SeverityFilter/
   ├── SeverityFilter.tsx
   ├── index.ts
   ├── constants.ts
   └── SeverityFilter.test.tsx
```

One route uses it, so it is route-local. It does **not** go in
`src/components/` "because a filter sounds reusable" — that is a guess, and a
wrong guess costs a folder nobody owns.

```
❌ src/components/severity-filter/        # no second consumer yet
❌ src/components/ui/SeverityFilter.tsx   # this folder does not exist here
❌ src/app/.../_components/SeverityFilter.tsx   # flat file, not a folder
```

**When it actually becomes shared** — the agents page needs the same dropdown:

```
src/components/severity-filter/    # kebab-case at this tier
├── SeverityFilter.tsx
├── index.ts
└── constants.ts
```

Real precedent: `src/components/findings-summary/` is a promoted component;
`src/app/repos/[repoId]/pulls/[number]/_components/SeverityCounters/` stayed
route-local because only that page renders it.

---

## 2. Private sub-parts nest, they don't become siblings

**Real path:** `AgentEditor` owns a config tab that nothing else can use.

```
✅ src/app/agents/[id]/_components/AgentEditor/
   ├── AgentEditor.tsx
   ├── _components/
   │   └── ConfigTab/
   │       ├── ConfigTab.tsx
   │       ├── constants.ts
   │       ├── styles.ts
   │       └── index.ts
   ├── constants.ts
   └── index.ts
```

```
❌ src/app/agents/[id]/_components/ConfigTab/   # reads as a peer of AgentEditor
```

The nesting carries information: a reader knows immediately that `ConfigTab`
has exactly one caller. `RunTraceDrawer/_components/` does the same with six
parts.

---

## 3. The illegal import that means "promote"

```ts
// ❌ in src/app/agents/_components/AgentCard/AgentCard.tsx
import { PRRow } from "../../../repos/[repoId]/pulls/_components/PRRow";
```

Reaching into another route's `_components/` is never allowed. The fix is not a
nicer import path — it is to move the component:

```ts
// ✅ after moving it to src/components/pr-row/
import { PRRow } from "@/components/pr-row";
```

---

## 4. `helpers.ts` — the React test

```ts
// ✅ src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/helpers.ts
import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence and/or off-severity findings, then sort. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severityFilter?: Severity | null,
): FindingRecord[] { /* … */ }
```

Data in, data out, no React import — testable without rendering.

```ts
// ❌ same file, if it looked like this
import { useMemo } from "react";

export function useVisibleFindings(findings: FindingRecord[]) {
  return useMemo(() => /* … */, [findings]);
}
```

The moment it imports `react` it is a hook, and it belongs in the component
file or `src/lib/hooks/` — not in `helpers.ts`.

---

## 5. Constants at the right tier

**Component tier** — used only by `FindingCard`:

```ts
// ✅ .../_components/FindingCard/constants.ts
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",   // token, never a hex value
  WARNING: "var(--warn)",
};
export const SEV_COLOR_FALLBACK = "var(--text-muted)";
```

**Route tier** — shared by `PRRow`, `FilterBar` and `page.tsx`, by nothing
outside the route:

```ts
// ✅ src/app/repos/[repoId]/pulls/constants.ts
export const GRID = "1fr 132px 92px 60px 132px 82px 118px 78px";
export const SIZE_SMALL_MAX = 100;
export const STATUS_META: Record<string, { c: string; labelKey: string }> = {
  needs_review: { c: "var(--warn)", labelKey: "needs_review" },  // key, not text
};
```

**What does not belong:**

```ts
❌ src/constants/index.ts                    // global dumping ground
❌ export const NEEDS_REVIEW = "Needs review";  // user-facing → messages/en/prReview.json
❌ export const CRIT = "#e5484d";               // → var(--crit)
```

Note `STATUS_META` stores `labelKey`, not a label. The English text lives in
`messages/en/prReview.json` under `list.status.needs_review`.

---

## 6. `helpers.ts` vs `src/lib/`

```ts
// ✅ src/lib/format.ts — four unrelated call sites need identical output
export function formatUsd(usd: number | null | undefined): string { /* … */ }
```

Named for its subject, used by the PR-list cost column, the timeline row, the
trace drawer and `VerdictBanner`.

```ts
// ✅ .../_components/FindingCard/helpers.ts — one component, stays local
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">) {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
```

```
❌ src/lib/utils.ts     // unnamed bucket — attracts everything, explains nothing
❌ src/lib/helpers.ts   // same problem
```

---

## 7. Business logic by kind

```tsx
// ❌ network call in a component
function PullsPage() {
  const [pulls, setPulls] = React.useState([]);
  React.useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_BASE}/repos/${repoId}/pulls`)
      .then((r) => r.json())
      .then(setPulls);
  }, [repoId]);
}
```

```tsx
// ✅ one seam: the hook
import { usePulls } from "@/lib/hooks";

function PullsPage() {
  const { data: pulls, isLoading, isError, refetch } = usePulls(repoId);
}
```

The hook lives in `src/lib/hooks/core.ts`, brings caching and invalidation with
it, and is the single place component tests mock.

---

## 8. Thin pages — the repo's own counter-example

`src/app/repos/[repoId]/pulls/page.tsx` today:

```tsx
// ❌ module-level constant stranded in page.tsx, next to a constants.ts
const OPEN_STATUSES = new Set(["needs_review", "reviewed", "stale"]);

export default function PullsPage() {
  // ❌ three-stage derivation inlined in the page
  const filtered = (pulls ?? [])
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
    .slice()
    .sort((a, b) => { /* date compare */ });
}
```

What it should be:

```ts
// ✅ src/app/repos/[repoId]/pulls/constants.ts
export const OPEN_STATUSES = new Set(["needs_review", "reviewed", "stale"]);

// ✅ src/app/repos/[repoId]/pulls/helpers.ts
export function filterAndSortPulls(
  pulls: PrMeta[], status: string, query: string, sort: string,
): PrMeta[] { /* … */ }
```

```tsx
// ✅ page.tsx wires, it does not derive
const filtered = filterAndSortPulls(pulls ?? [], status, query, sort);
```

The route already has both files — `sizeOf` and `relativeTime` live in that
`helpers.ts`. This logic was simply never moved.

---

## 9. Barrels

```ts
// ✅ component barrel — one explicit line
// .../_components/FindingCard/index.ts
export { FindingCard, FindingCard as default } from "./FindingCard";
```

```ts
// ✅ shared folder barrel — a curated public API
// src/components/diff-viewer/index.ts
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
```

Seven component folders live inside `diff-viewer/`; exactly one is exported.
That is the surface being designed, not mirrored.

```ts
❌ export * from "./AppShell";        // star export — hides the surface
❌ // src/components/index.ts
   export * from "./app-shell";
   export * from "./diff-viewer";     // cross-tier mega-barrel: cycles + no tree-shaking
```

`src/components/app-shell/index.ts` uses the star form and
`src/lib/hooks/index.ts` is a deliberate `export *` aggregator. The hooks barrel
stays; don't add more.

---

## 10. Imports

```ts
// ❌ src/app/repos/[repoId]/pulls/constants.ts — as it is today
import type { PrMeta } from "../../../../lib/types";

// ✅
import type { PrMeta } from "@/lib/types";
```

```ts
// ✅ relative is right inside a component folder
import { SEV_COLOR } from "./constants";
import { s } from "./styles";
import { ConfigTab } from "./_components/ConfigTab";
```

---

## 11. Server/client boundary

```tsx
// ❌ directive on a wrapper drags the whole subtree client-side
"use client";
import { HeavyServerTable } from "./HeavyServerTable";

export function Panel() {
  const [open, setOpen] = React.useState(false);
  return open ? <HeavyServerTable /> : null;
}
```

```tsx
// ✅ server content passed through as children; only the toggle is client
// Panel.tsx
"use client";
export function Panel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return open ? children : null;
}

// page.tsx (server component)
<Panel><HeavyServerTable /></Panel>
```

---

## 12. Types

```ts
// ✅ contract from the shared package, DTO casing preserved
import type { FindingRecord } from "@devdigest/shared";

function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">) { /* … */ }
```

```ts
// ❌ retyped locally, casing "fixed" — now it silently disagrees with the wire
type Finding = { startLine: number; endLine: number };
```

Props types stay next to their component:

```tsx
// ✅ inside FindingCard.tsx
type FindingCardProps = { finding: FindingRecord; focused: boolean };
```
