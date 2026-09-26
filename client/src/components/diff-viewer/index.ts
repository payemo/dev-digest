/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   an optional generic findings slot.
   Public surface: the DiffViewer component + the two API contracts a caller
   needs to construct (DiffCommentApi, DiffFindingApi/DiffFindingAnchor). */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export type { DiffFindingAnchor, DiffFindingApi } from "./findings";
