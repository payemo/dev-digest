/* Deep-link target support for the DiffViewer.

   A caller (e.g. the PR Brief's "read these first" list) can point the viewer
   at one file and, optionally, one new-side line: the matching file card
   force-opens, the line is highlighted, and it is scrolled into view. The
   target is only ever compared against paths and line numbers — never
   rendered as markup or used as a URL. */

/** A file (and optional RIGHT-side line) the viewer should bring into view. */
export interface DiffTarget {
  file: string;
  line: number | null;
}
