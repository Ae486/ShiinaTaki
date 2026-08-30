/**
 * INPUT:  the shell's actually-shown page id (nav state AFTER the monitor-disabled fallback — the page the operator
 *         can see), written once per change; pages only read.
 * OUTPUT: usePageVisibilityStore + usePageVisible(id) — the P1e keep-alive gate signal: hidden pages stop working
 *         (subscriptions, fetches, re-publishes) and reactivate on show. The chat page deliberately ignores it.
 * POS:    ui/windows/home — one store per domain (UI visibility only, no state of record). A separate store (not the
 *         nav store) because the shown page can differ from navigation intent while the monitor-disabled fallback
 *         reroutes; the shell is the single writer from its rendered output.
 */

import { create } from "zustand";
import { DEFAULT_PAGE_ID } from "./default-page-id.ts";
import type { PageId } from "./pages.ts";

interface PageVisibilityState {
  activePage: PageId;
  setActivePage: (page: PageId) => void;
}

export const usePageVisibilityStore = create<PageVisibilityState>()((set) => ({
  activePage: DEFAULT_PAGE_ID,
  setActivePage: (page) => set({ activePage: page }),
}));

/** Whether the page instance with this registry id is the one the shell is currently showing. */
export function usePageVisible(id: PageId): boolean {
  return usePageVisibilityStore((state) => state.activePage === id);
}
