/**
 * INPUT:  navigate() calls from the left menu, the boot query param and the home:navigate event.
 * OUTPUT: useHomeStore — { currentPage: PageId, navigate(id) }.
 * POS:    ui/windows/home — the home window's navigation domain (one store per domain). UI state only: the home
 *         window holds no state of record (invariant 4).
 */

import { create } from "zustand";
import { DEFAULT_PAGE_ID } from "./default-page-id.ts";
import type { PageId } from "./pages.ts";

interface HomeState {
  currentPage: PageId;
  navigate: (page: PageId) => void;
}

export const useHomeStore = create<HomeState>()((set) => ({
  currentPage: DEFAULT_PAGE_ID,
  navigate: (page) => set({ currentPage: page }),
}));
