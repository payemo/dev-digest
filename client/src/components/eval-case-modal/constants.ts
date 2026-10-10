/** Modal width — two columns (input left, expected output right), mockups 2/7/8. */
export const MODAL_WIDTH = 980;

/** Defaults the "Finding skeleton" button fills in (data, not UI copy). */
export const SKELETON_DEFAULTS = {
  severity: "WARNING",
  category: "bug",
  title: "Expected finding title",
} as const;

/** Rows of the editable diff / expected-output textareas. */
export const DIFF_ROWS = 12;
export const EXPECTED_ROWS = 14;
