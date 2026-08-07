/**
 * INPUT:  `home:navigate` Tauri events emitted by openHome() when the home window is already open.
 * OUTPUT: useHomeNavigateEvent() — drives the home store's navigate() from validated event payloads.
 * POS:    ui/windows/home — the inbound half of the pet→home navigation seam. Unregistered page ids are dropped with
 *         a breadcrumb (never a throw inside an event callback).
 */

import { HOME_NAVIGATE_EVENT } from "@/lib/open-home-window.js";
import { useTauriEvent } from "@/lib/use-tauri-event.js";
import { useHomeStore } from "./home-store.ts";
import { isPageId } from "./pages.ts";

function requestedPage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("page" in payload)) return null;
  const { page } = payload as { page: unknown };
  return typeof page === "string" ? page : null;
}

export function useHomeNavigateEvent(): void {
  useTauriEvent(HOME_NAVIGATE_EVENT, (payload) => {
    const page = requestedPage(payload);
    if (isPageId(page)) useHomeStore.getState().navigate(page);
    else console.warn(`[home] ignored navigate to unregistered page: ${String(page)}`);
  });
}
