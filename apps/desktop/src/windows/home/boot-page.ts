/**
 * INPUT:  the window's location search string (`?page=chat`).
 * OUTPUT: pageFromSearch(search) -> PageId — the requested page, or the default for anything unregistered.
 * POS:    ui/windows/home — the boot-parameter gate (pure, node-testable). An unknown/absent param must never leave
 *         the shell without a page to render, so it falls back instead of throwing.
 */

import { DEFAULT_PAGE_ID, isPageId, type PageId } from "./pages.ts";

export function pageFromSearch(search: string): PageId {
  const requested = new URLSearchParams(search).get("page");
  return isPageId(requested) ? requested : DEFAULT_PAGE_ID;
}
