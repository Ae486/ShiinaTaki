/**
 * INPUT:  the Home window's visited page ids and the latest navigation target.
 * OUTPUT: appendVisitedPage() — an ordered, duplicate-free visited-page sequence.
 * POS:    ui/windows/home — dependency leaf for the shell keep-alive host; no React or Core ownership.
 */

import type { PageId } from "./pages.ts";

/** Keeps a page in the Home window's in-memory keep-alive set after its first visit. */
export function appendVisitedPage(visited: readonly PageId[], page: PageId): readonly PageId[] {
  return visited.includes(page) ? visited : [...visited, page];
}
