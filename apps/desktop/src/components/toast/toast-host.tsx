/**
 * INPUT:  the window-local toast queue and document dismissal events.
 * OUTPUT: fixed polite notification stack with Escape/outside dismissal and zero normal-flow height.
 * POS:    one host per window root; ToastCard owns reading lifetime and data-keep-interactive preserves Pet input.
 */

import { useEffect, useRef } from "react";
import { useToastStore } from "./toast-store.ts";
import { ToastCard } from "./toast-card.tsx";

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

  // A4 keyboard dismissal: Escape clears the whole stack (close buttons cover single toasts).
  useEffect(() => {
    if (toasts.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissAll();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toasts.length, dismissAll]);

  if (toasts.length === 0) return null;
  return (
    <div
      ref={hostRef}
      role="status"
      aria-live="polite"
      data-keep-interactive
      className="pointer-events-none fixed left-1/2 top-3 z-(--z-toast) flex w-max max-w-[90vw] -translate-x-1/2 flex-col items-center gap-1.5"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
