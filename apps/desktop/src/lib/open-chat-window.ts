/**
 * INPUT:  a click on the bubble's "expand" affordance (pet window).
 * OUTPUT: openChatWindow() — shows+focuses the existing chat window, or creates it at runtime (chat.html).
 * POS:    ui/lib — the pet→chat window opener (research r4). Runtime-created (no tauri.conf.json entry); the chat
 *         window is a disposable client whose own WS dies with it (invariant 4). Needs the pet capability's
 *         core:webview:allow-create-webview-window + core:window:allow-set-focus + the get-all pair
 *         (core:window:allow-get-all-windows, core:webview:allow-get-all-webviews — getByLabel calls them).
 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const CHAT_LABEL = "chat";

/** Opens (or re-focuses) the chat window; safe to call repeatedly — closing it destroys it, the next call recreates it. */
export async function openChatWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(CHAT_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  const chat = new WebviewWindow(CHAT_LABEL, {
    url: "chat.html",
    title: "TakiAgent Chat",
    width: 720,
    height: 800,
    resizable: true,
  });
  // Await the created/error race so a failure REJECTS to the caller — packaged builds have no devtools, so a
  // console-only error is invisible (B-test: the open click silently did nothing).
  await new Promise<void>((resolve, reject) => {
    void chat.once("tauri://created", () => resolve());
    void chat.once("tauri://error", (event) => reject(new Error(JSON.stringify(event.payload ?? "unknown error"))));
  });
}
