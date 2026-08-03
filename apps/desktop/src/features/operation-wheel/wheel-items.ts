/**
 * INPUT:  a wheel row's run() call with the pet-side context (the costume-panel opener).
 * OUTPUT: WHEEL_ITEMS — the ordered registry the wheel renders; each row is a shortcut that navigates the home window
 *         or opens a pet-side overlay. Failures toast instead of rejecting into a dead click.
 * POS:    ui/features/operation-wheel — THE wheel registry (invariant 7): adding an entry is one row here and nothing
 *         else changes. Costume stays pet-side until its home page exists (batch 4).
 */

import { openHome } from "@/lib/open-home-window.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { DEFAULT_PAGE_ID, type PageId } from "@/windows/home/pages.js";

export interface WheelItemContext {
  /** Opens the pet-window costume/character panel (no PetScene exists outside this window). */
  openCostume: () => void;
}

export interface WheelItem {
  id: string;
  label: string;
  run: (ctx: WheelItemContext) => void;
}

// Packaged builds have no devtools, so a rejected navigation must surface as a toast (same rule as the bubble's
// expand button, D34) — otherwise the wheel item just looks dead.
function navigate(page: PageId): void {
  openHome(page).catch((cause: unknown) => {
    console.error("home window failed to open", cause);
    pushToast(`无法打开主窗口: ${cause instanceof Error ? cause.message : String(cause)}`);
  });
}

export const WHEEL_ITEMS = [
  { id: "chat", label: "聊天", run: () => navigate("chat") },
  { id: "home", label: "主页", run: () => navigate(DEFAULT_PAGE_ID) },
  { id: "costume", label: "换装", run: (ctx) => ctx.openCostume() },
] as const satisfies readonly WheelItem[];
