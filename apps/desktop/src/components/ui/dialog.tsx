/**
 * INPUT:  open/onClose plus the escape policy, labelling, size and children; approval runs with
 *         escapePolicy="none" (fail-closed: no close affordance, Escape dismisses nothing).
 * OUTPUT: <Dialog> — the ONE modal shell: dark backdrop at the dialog z-tier, focus trapped inside the
 *         card, initial focus on the card, focus restored to the invoker on close. The built-in close
 *         button renders only when escapePolicy="close".
 * POS:    ui/components — shared primitive (batch-2 C4, A1 closes here: the approval dialog migrates onto it).
 *         No portal/side-drawer machinery yet (YAGNI; design §5).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./icon-button.tsx";
import { XIcon } from "@/lib/icons/x-icon.js";

export type EscapePolicy = "close" | "none";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  escapePolicy?: EscapePolicy;
  labelledBy?: string;
  ariaLabel?: string;
  size?: "md" | "lg";
  children: ReactNode;
}

/** The pure escape decision, exported so the fail-closed policy is regression-tested without a DOM. */
export function escapeRequestsClose(policy: EscapePolicy, key: string): boolean {
  return policy === "close" && key === "Escape";
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

// Keyboard focus behaviour: Tab cycles inside the card, Escape obeys the policy. DOM-bound (the
// repo's tests render statically), so the pure half lives in escapeRequestsClose.
function useDialogFocus(open: boolean, escapePolicy: EscapePolicy, onClose: () => void) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    card?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!card) return;
      if (escapeRequestsClose(escapePolicy, event.key)) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const tiles = focusables(card);
      if (tiles.length === 0) {
        event.preventDefault();
        return;
      }
      const first = tiles[0]!;
      const last = tiles[tiles.length - 1]!;
      const active = document.activeElement;
      // Focus may land OUTSIDE the card (e.g. body after a backdrop click): pull it back in before
      // the edge checks, or a forward Tab would follow DOM order onto the page behind the modal.
      if (active && !card.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (active === first || active === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      invoker?.focus(); // restore focus to whatever opened the dialog
    };
  }, [open, escapePolicy, onClose]);
  return cardRef;
}

const SIZE: Record<"md" | "lg", string> = { md: "max-w-lg", lg: "max-w-2xl" };

export function Dialog({
  open,
  onClose,
  escapePolicy = "close",
  labelledBy,
  ariaLabel,
  size = "md",
  children,
}: DialogProps) {
  const cardRef = useDialogFocus(open, escapePolicy, onClose);
  if (!open) return null;
  return (
    <div
      data-keep-interactive
      className="fixed inset-0 z-(--z-dialog) grid place-items-center bg-backdrop p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`relative w-full ${SIZE[size]} rounded-2xl border border-border bg-surface p-5 shadow-modal focus:outline-none`}
      >
        {escapePolicy === "close" && (
          <div className="absolute right-2.5 top-2.5">
            <IconButton label="关闭" size="sm" onClick={onClose}>
              <XIcon className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
