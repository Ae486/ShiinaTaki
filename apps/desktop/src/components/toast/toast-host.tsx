/**
 * INPUT:  the window-local toast queue (toast-store).
 * OUTPUT: <ToastHost> — a fixed overlay stack at the toast z-tier (occupies NO layout height, so dismissal
 *         never causes reflow jumps). A4 contract: the stack is role=status + aria-live=polite, every toast has
 *         a labelled close button, hovering pauses its timer, CLICKING it pauses for good (closes the D34
 *         deviation), Escape clears the stack, and clicking outside dismisses all. Text stays selectable.
 * POS:    ui/components/toast — the ONE reusable transient-notice surface (D34). Mounted once per window root;
 *         carries data-keep-interactive so it stays clickable over the pet overlay's transparent pixels.
 */

import { useEffect, useRef } from "react";
import { useToastStore, type Toast } from "./toast-store.ts";
import { IconButton } from "@/components/ui/icon-button.js";
import { XIcon } from "@/lib/icons/x-icon.js";

const AUTO_DISMISS_MS = 6_000;

const TONE_CLASSES: Record<Toast["tone"], string> = {
  error: "bg-danger-deep/90 text-danger-soft ring-danger-strong/50",
  info: "bg-surface-strong/90 text-white ring-border-strong/50",
};

function ToastCard({ toast }: { toast: Toast }) {
  const timer = useRef<number | null>(null);
  const readRef = useRef(false);

  // getState() avoids subscribing the card to the store (dismiss identity is stable there, no effect deps needed).
  const pause = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const arm = () => {
    if (readRef.current) return; // a clicked toast stays for reading until closed or stack-cleared
    pause();
    timer.current = window.setTimeout(() => useToastStore.getState().dismiss(toast.id), AUTO_DISMISS_MS);
  };
  useEffect(() => {
    arm();
    return pause;
    // arm/pause are stable closures over refs; the timer belongs to this toast id alone.
  }, [toast.id]);

  return (
    <div
      onPointerDown={() => {
        readRef.current = true;
        pause();
      }}
      onMouseEnter={pause}
      onMouseLeave={arm}
      className={`pointer-events-auto flex select-text items-start gap-2 rounded-lg py-2 pl-3 pr-1.5 text-xs shadow-overlay ring-1 ${TONE_CLASSES[toast.tone]}`}
    >
      <span className="min-w-0">{toast.message}</span>
      <IconButton label="关闭通知" size="sm" tone="onDark" onClick={() => useToastStore.getState().dismiss(toast.id)}>
        <XIcon className="h-3.5 w-3.5" />
      </IconButton>
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
