/**
 * INPUT:  a Tauri event name + the handler that should see each raw payload (validation is the caller's job).
 * OUTPUT: useTauriEvent(event, handler) — registers ONE listener for the component's life, unlistens on unmount.
 * POS:    ui/lib — the shared window-event plumbing every cross-window seam sits on (home:navigate, the costume legs).
 *         Registration is stable: the handler is read through a ref, so a changing closure never churns the listener.
 */

import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function useTauriEvent(event: string, handler: (payload: unknown) => void): void {
  const sink = useRef(handler);
  useEffect(() => {
    sink.current = handler;
  });

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void listen(event, (received) => sink.current(received.payload))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => console.error(`[ui] ${event} listener failed`, error));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event]);
}
