/**
 * INPUT:  a click on a pet-side shortcut (bubble expand button today, the operation wheel next batch).
 * OUTPUT: openHome(pageId) — creates the home window at that page, or navigates the open one; HOME_NAVIGATE_EVENT.
 * POS:    ui/lib — the pet→home window seam. Single instance BY CONSTRUCTION: the window label is a constant and an
 *         existing window is reused, never re-created. Needs the pet capability's create-webview-window + set-focus +
 *         the get-all pair (getByLabel calls them) + core:event:default (emitTo).
 */

import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { PageId } from "@/windows/home/pages.js";

const HOME_LABEL = "home";

/** Navigation push for an ALREADY-open home window (a fresh window boots from the `?page=` query instead). */
export const HOME_NAVIGATE_EVENT = "home:navigate";

export interface HomeNavigatePayload {
  page: PageId;
}

/** Opens the home window at `pageId`, or navigates + focuses it when it is already open. */
export async function openHome(pageId: PageId): Promise<void> {
  const existing = await WebviewWindow.getByLabel(HOME_LABEL);
  if (existing) {
    await existing.show();
    await emitTo(HOME_LABEL, HOME_NAVIGATE_EVENT, { page: pageId } satisfies HomeNavigatePayload);
    await existing.setFocus();
    return;
  }
  const home = new WebviewWindow(HOME_LABEL, {
    url: `home.html?page=${encodeURIComponent(pageId)}`,
    title: "TakiAgent",
    width: 900,
    height: 800,
    resizable: true,
  });
  // Await the created/error race so a failure REJECTS to the caller — packaged builds have no devtools, so a
  // console-only error is invisible (B-test: the open click silently did nothing).
  await new Promise<void>((resolve, reject) => {
    void home.once("tauri://created", () => resolve());
    void home.once("tauri://error", (event) => reject(new Error(JSON.stringify(event.payload ?? "unknown error"))));
  });
}
