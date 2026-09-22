export type ConventionFilter = "all" | "pending" | "approved" | "rejected";

export const FILTERS: { key: ConventionFilter; labelKey: string }[] = [
  { key: "pending", labelKey: "page.filters.pending" },
  { key: "approved", labelKey: "page.filters.approved" },
  { key: "rejected", labelKey: "page.filters.rejected" },
  { key: "all", labelKey: "page.filters.all" },
];

export const SKELETON_CARDS = 3;
