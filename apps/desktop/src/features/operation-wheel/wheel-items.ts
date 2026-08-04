/**
 * INPUT:  a wheel row's run() call.
 * OUTPUT: WHEEL_ITEMS — the ordered registry the wheel renders; every row is a shortcut that opens the home window at
 *         one page. Failures toast instead of rejecting into a dead click.
 * POS:    ui/features/operation-wheel — THE wheel registry (invariant 7): adding an entry is one row here and nothing
 *         else changes. Every surface now lives in the home window, so no row reaches into pet-window state.
 */

import { openHome } from "@/lib/open-home-window.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { DEFAULT_PAGE_ID, type PageId } from "@/windows/home/pages.js";

export interface WheelItem {
  id: string;
  label: string;
  run: () => void;
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
  { id: "settings", label: "设置", run: () => navigate("settings") },
  { id: "costume", label: "换装", run: () => navigate("costume") },
  { id: "home", label: "主页", run: () => navigate(DEFAULT_PAGE_ID) },
] as const satisfies readonly WheelItem[];
