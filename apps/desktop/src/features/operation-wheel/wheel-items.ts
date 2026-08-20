/**
 * INPUT:  a wheel row's run() call.
 * OUTPUT: WHEEL_ITEMS — the ordered registry the wheel renders; every row carries its glyph + label and is a shortcut
 *         that opens the home window at one page. Failures toast instead of rejecting into a dead click.
 * POS:    ui/features/operation-wheel — THE wheel registry (invariant 7): adding an entry is one row here and nothing
 *         else changes. Every surface now lives in the home window, so no row reaches into pet-window state.
 */

import { openHome } from "@/lib/open-home-window.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { DEFAULT_PAGE_ID } from "@/windows/home/default-page-id.js";
import type { PageId } from "@/windows/home/pages.js";
import type { IconComponent } from "@/lib/icons/glyph.js";
import { ChatIcon } from "@/lib/icons/chat-icon.js";
import { SettingsIcon } from "@/lib/icons/settings-icon.js";
import { CostumeIcon } from "@/lib/icons/costume-icon.js";
import { HomeIcon } from "@/lib/icons/home-icon.js";

export interface WheelItem {
  id: string;
  label: string;
  icon: IconComponent;
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
  { id: "chat", label: "聊天", icon: ChatIcon, run: () => navigate("chat") },
  { id: "settings", label: "设置", icon: SettingsIcon, run: () => navigate("settings") },
  { id: "costume", label: "换装", icon: CostumeIcon, run: () => navigate("costume") },
  { id: "home", label: "主页", icon: HomeIcon, run: () => navigate(DEFAULT_PAGE_ID) },
] as const satisfies readonly WheelItem[];
