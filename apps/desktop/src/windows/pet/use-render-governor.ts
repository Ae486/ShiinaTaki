/**
 * INPUT:  a RenderGovernor (once the scene has loaded) + Tauri focus and DOM visibility signals.
 * OUTPUT: listen-before-read native focus seeding, live focus/visibility updates and fenced effect cleanup.
 * POS:    ui/windows/pet — hook owns the Tauri/DOM listener lifecycle (components never subscribe directly).
 *         visibilitychange is the provable minimize/hide pause; focus is the blur throttle (perf AC, issue #14).
 */

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { RenderGovernor } from "@/renderer/render-governor.js";

export function useRenderGovernor(governor: RenderGovernor | null): void {
  useEffect(() => {
    if (!governor) return;

    let disposed = false;
    let focusRevision = 0;
    const onVisibility = () => { if (!disposed) governor.setHidden(document.hidden); };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility(); // seed from the current state rather than waiting for the first change

    let unlistenFocus: UnlistenFn | undefined;
    const nativeWindow = getCurrentWindow();
    void nativeWindow.onFocusChanged(({ payload: focused }) => {
      if (disposed) return;
      focusRevision += 1;
      governor.setFocused(focused);
    }).then(async (unlisten) => {
      if (disposed) { unlisten(); return; }
      unlistenFocus = unlisten;
      const readRevision = focusRevision;
      try {
        const focused = await nativeWindow.isFocused();
        // A later native event is newer than this asynchronous seed, even if its query reply arrives last.
        if (!disposed && focusRevision === readRevision) governor.setFocused(focused);
      } catch (cause) {
        if (disposed) return;
        console.warn("[pet] initial native focus unavailable; using current document focus", cause);
        if (focusRevision === readRevision) governor.setFocused(document.hasFocus());
      }
    }).catch((cause: unknown) => {
      if (disposed) return;
      console.warn("[pet] native focus listener unavailable; using current document focus", cause);
      governor.setFocused(document.hasFocus());
    });

    return () => {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      unlistenFocus?.();
      unlistenFocus = undefined;
    };
  }, [governor]);
}
