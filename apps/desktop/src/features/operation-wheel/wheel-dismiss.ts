/**
 * INPUT:  an event target (the window), a predicate telling whether an event landed on the wheel, and the closer.
 * OUTPUT: installWheelDismiss(deps) — attaches pointerdown / Escape / blur dismissal and returns the disposer.
 * POS:    ui/features/operation-wheel — framework-free dismissal policy, node-testable; the hook is a thin lifecycle
 *         wrapper. Listeners exist ONLY while the wheel is open (the overlay does no idle work when closed).
 */

export interface WheelDismissEvent {
  target?: unknown;
  key?: string;
}

export type WheelDismissListener = (event: WheelDismissEvent) => void;

/** The slice of `window` this policy needs — method syntax on purpose, so both `window` and a test double fit. */
export interface WheelDismissTarget {
  addEventListener(type: string, handler: WheelDismissListener, options?: unknown): void;
  removeEventListener(type: string, handler: WheelDismissListener, options?: unknown): void;
}

export interface WheelDismissDeps {
  target: WheelDismissTarget;
  close: () => void;
  isInsideWheel: (target: unknown) => boolean;
}

export function installWheelDismiss(deps: WheelDismissDeps): () => void {
  // Capture phase so the wheel is already closed by the time the stage's own handlers run — and NOTHING is
  // prevented or stopped here: the click that dismisses still does whatever it would normally do (owner's
  // "intuitive" ruling; best-effort pass-through).
  const onPointerDown: WheelDismissListener = (event) => {
    if (!deps.isInsideWheel(event.target)) deps.close();
  };
  const onKeyDown: WheelDismissListener = (event) => {
    if (event.key === "Escape") deps.close();
  };
  const onBlur: WheelDismissListener = () => deps.close();

  const options = { capture: true };
  deps.target.addEventListener("pointerdown", onPointerDown, options);
  deps.target.addEventListener("keydown", onKeyDown, options);
  deps.target.addEventListener("blur", onBlur);

  return () => {
    deps.target.removeEventListener("pointerdown", onPointerDown, options);
    deps.target.removeEventListener("keydown", onKeyDown, options);
    deps.target.removeEventListener("blur", onBlur);
  };
}
