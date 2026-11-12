/**
 * INPUT:  one immutable toast event from the window-local queue.
 * OUTPUT: selectable notification with shared pointer/keyboard reading protection and labelled dismissal.
 * POS:    ToastHost child keyed by event/card identity; its Effect owns the presentation deadline.
 */
import { useEffect, useMemo } from "react";
import { IconButton } from "@/components/ui/icon-button.js";
import { XIcon } from "@/lib/icons/x-icon.js";
import { createToastLifetime } from "./toast-lifetime.ts";
import { useToastStore, type Toast } from "./toast-store.ts";

const TONE_CLASSES: Record<Toast["tone"], string> = {
  error: "bg-danger-deep/90 text-danger-soft ring-danger-strong/50",
  info: "bg-surface-strong/90 text-white ring-border-strong/50",
  success: "bg-ok-strong/95 text-ok-soft ring-ok-border/50",
  warn: "bg-warn-deep/95 text-warn-soft ring-warn-border/50",
};
const CARD = "pointer-events-auto flex select-text items-start gap-2 rounded-lg py-2 pl-3 pr-1.5 text-xs shadow-overlay ring-1 focus-visible:outline-2 focus-visible:outline-offset-2";

export function ToastCard({ toast }: { toast: Toast }) {
  const lifetime = useMemo(() => createToastLifetime(() => useToastStore.getState().dismiss(toast.id)), [toast.id]);
  useEffect(() => { lifetime.start(); return lifetime.stop; }, [lifetime]);
  return (
    <div
      tabIndex={0}
      role="group"
      aria-label="通知"
      aria-describedby={`toast-message-${toast.id}`}
      onPointerDown={lifetime.hold}
      onMouseEnter={() => lifetime.pause("pointer")}
      onMouseLeave={() => lifetime.resume("pointer")}
      onFocusCapture={() => lifetime.pause("focus")}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) lifetime.resume("focus");
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          lifetime.hold();
        }
      }}
      className={`${CARD} ${TONE_CLASSES[toast.tone]}`}
    >
      <span id={`toast-message-${toast.id}`} className="min-w-0">{toast.message}</span>
      <IconButton label="关闭通知" size="sm" tone="onDark" onClick={() => useToastStore.getState().dismiss(toast.id)}>
        <XIcon className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}
