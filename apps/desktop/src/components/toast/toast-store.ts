/**
 * INPUT:  action-owned notices with optional opaque event identity and operation/target replacement key.
 * OUTPUT: bounded window-local toast queue, once-only event consumption and explicit dismissal.
 * POS:    shared transient presentation; persistent validation/diagnostics remain at their owning views.
 */

import { create } from "zustand";

export type ToastTone = "error" | "info" | "success" | "warn";

export interface ToastOptions {
  /** Reuse the producer's object for the same event, including Effect replay after dismissal. */
  eventKey?: object;
  /** A later attempt for this operation/target supersedes its prior visible result. */
  replaceKey?: string;
}

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  replaceKey?: string;
}

/** A4: the stack never grows unbounded — a burst of failures keeps the most recent four. */
export const MAX_TOASTS = 4;

type ToastStore = {
  toasts: Toast[];
  push: (message: string, tone: ToastTone, options?: ToastOptions) => void;
  dismiss: (id: string) => void;
  dismissGroup: (replaceKey: string) => void;
  dismissAll: () => void;
};

let toastSeq = 0;
// Weak identities remain consumed while their producer can redeliver them, without keeping an
// unbounded message/key ledger. Dismissal does not turn an already-consumed event into a new one.
const consumedEvents = new WeakSet<object>();

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  push: (message, tone, options = {}) => {
    if (options.eventKey && consumedEvents.has(options.eventKey)) return;
    if (options.eventKey) consumedEvents.add(options.eventKey);
    const toast = { id: `t${++toastSeq}`, message, tone, replaceKey: options.replaceKey };
    set((state) => ({ toasts: [
      ...state.toasts.filter((item) => !options.replaceKey || item.replaceKey !== options.replaceKey), toast,
    ].slice(-MAX_TOASTS) }));
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  dismissGroup: (replaceKey) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.replaceKey !== replaceKey) })),
  dismissAll: () => set({ toasts: [] }),
}));

/** Push from non-React code paths (ws handlers, async catches). Defaults to the error tone. */
export function pushToast(message: string, tone: ToastTone = "error", options?: ToastOptions): void {
  useToastStore.getState().push(message, tone, options);
}

export function dismissToastGroup(replaceKey: string): void {
  useToastStore.getState().dismissGroup(replaceKey);
}
