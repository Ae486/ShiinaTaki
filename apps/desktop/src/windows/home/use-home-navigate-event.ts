/**
 * INPUT:  `home:navigate` Tauri events emitted by openHome() when the home window is already open.
 * OUTPUT: useHomeNavigateEvent() — drives the home store's navigate() from validated event payloads.
 * POS:    ui/windows/home — the inbound half of the pet→home navigation seam. Unregistered page ids are dropped with
 *         a breadcrumb (never a throw inside an event callback).
 */

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { HOME_NAVIGATE_EVENT } from "@/lib/open-home-window.js";
import { useHomeStore } from "./home-store.ts";
import { isPageId } from "./pages.ts";

function requestedPage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("page" in payload)) return null;
  const { page } = payload as { page: unknown };
  return typeof page === "string" ? page : null;
}

export function useHomeNavigateEvent(): void {
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void listen(HOME_NAVIGATE_EVENT, (event) => {
      const page = requestedPage(event.payload);
      if (isPageId(page)) useHomeStore.getState().navigate(page);
      else console.warn(`[home] ignored navigate to unregistered page: ${String(page)}`);
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => console.error("[home] navigate listener failed", error));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
