/**
 * INPUT:  HomeShell's actually rendered route and real document visibility changes.
 * OUTPUT: legacy route visibility plus effective usePageActive/isPageActive gates for disposable reads.
 * POS:    ui/home — display demand only; existing Chat/Monitor policies and Core/Host command lifetimes stay separate.
 */

import { create } from "zustand";
import { DEFAULT_PAGE_ID } from "./default-page-id.ts";
import type { PageId } from "./pages.ts";

interface PageVisibilityState {
  activePage: PageId;
  documentVisible: boolean;
  setActivePage: (page: PageId) => void;
  setDocumentVisible: (visible: boolean) => void;
}

export const usePageVisibilityStore = create<PageVisibilityState>()((set) => ({
  activePage: DEFAULT_PAGE_ID,
  documentVisible: typeof document === "undefined" || document.visibilityState !== "hidden",
  setActivePage: (page) => set({ activePage: page }),
  setDocumentVisible: (visible) => set({ documentVisible: visible }),
}));

/** Whether the page instance with this registry id is the one the shell is currently showing. */
export function usePageVisible(id: PageId): boolean {
  return usePageVisibilityStore((state) => state.activePage === id);
}

/** Existing Chat/Monitor owners retain their own visibility contract; new disposable reads use this effective gate. */
export function usePageActive(id: PageId): boolean {
  return usePageVisibilityStore((state) => state.activePage === id && state.documentVisible);
}

export function isPageActive(id: PageId): boolean {
  const state = usePageVisibilityStore.getState();
  return state.activePage === id && state.documentVisible;
}
