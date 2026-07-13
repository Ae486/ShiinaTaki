/**
 * INPUT:  a RenderGovernor (once the scene has loaded) + Tauri focus and DOM visibility signals.
 * OUTPUT: wires onFocusChanged → governor.setFocused and visibilitychange → governor.setHidden, with effect cleanup.
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

    const onVisibility = () => governor.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility(); // seed from the current state rather than waiting for the first change

    let unlistenFocus: UnlistenFn | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => governor.setFocused(focused))
      .then((unlisten) => (unlistenFocus = unlisten));

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unlistenFocus?.();
    };
  }, [governor]);
}
