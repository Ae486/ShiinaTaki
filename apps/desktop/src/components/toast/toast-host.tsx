/**
 * INPUT:  the window-local toast queue (toast-store).
 * OUTPUT: <ToastHost> — a fixed overlay stack (occupies NO layout height, so dismissal never causes reflow jumps).
 *         Each toast auto-dismisses after a few seconds; hovering it pauses the timer (read/copy); clicking anywhere
 *         OUTSIDE the stack dismisses all; text stays selectable.
 * POS:    ui/components/toast — the ONE reusable transient-notice surface (D34). Mounted once per window root;
 *         carries data-keep-interactive so it stays clickable over the pet overlay's transparent pixels.
 */

import { useEffect, useRef } from "react";
import { useToastStore, type Toast } from "./toast-store.ts";

const AUTO_DISMISS_MS = 6_000;

const TONE_CLASSES: Record<Toast["tone"], string> = {
  error: "bg-rose-900/90 text-rose-50 ring-rose-700/50",
  info: "bg-slate-800/90 text-slate-50 ring-slate-600/50",
};

function ToastCard({ toast }: { toast: Toast }) {
  const timer = useRef<number | null>(null);

  // getState() avoids subscribing the card to the store (dismiss identity is stable there, no effect deps needed).
  const pause = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const arm = () => {
    pause();
    timer.current = window.setTimeout(() => useToastStore.getState().dismiss(toast.id), AUTO_DISMISS_MS);
  };
  useEffect(() => {
    timer.current = window.setTimeout(() => useToastStore.getState().dismiss(toast.id), AUTO_DISMISS_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [toast.id]);

  return (
    <div
      onMouseEnter={pause}
      onMouseLeave={arm}
      className={`pointer-events-auto select-text rounded-lg px-3 py-2 text-xs shadow-lg ring-1 ${TONE_CLASSES[toast.tone]}`}
    >
      {toast.message}
    </div>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissAll = useToastStore((s) => s.dismissAll);
  const hostRef = useRef<HTMLDivElement>(null);

  // A click anywhere OUTSIDE the stack dismisses all (per D34); clicks/hovers ON a toast keep it for reading/copying.
  useEffect(() => {
    if (toasts.length === 0) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !hostRef.current?.contains(event.target)) dismissAll();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [toasts.length, dismissAll]);

  if (toasts.length === 0) return null;
  return (
    <div
      ref={hostRef}
      data-keep-interactive
      className="pointer-events-none fixed left-1/2 top-3 z-50 flex w-max max-w-[90vw] -translate-x-1/2 flex-col items-center gap-1.5"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
