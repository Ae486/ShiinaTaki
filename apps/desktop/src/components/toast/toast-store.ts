/**
 * INPUT:  pushToast(message, tone?) calls from anywhere in the window (hooks, components, non-React code).
 * OUTPUT: the window-local toast queue (zustand) + push/dismiss/dismissAll reducers; ToastHost renders it.
 *         The stack is capped at MAX_TOASTS — the oldest toast is dropped (A4 stacking cap).
 * POS:    ui/components/toast — per-window store (windows share no JS memory; each window mounts its own host).
 *         Toasts are TRANSIENT notices (errors, cancellations); persistent state banners stay owned by their views.
 */

import { create } from "zustand";

export type ToastTone = "error" | "info";

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

/** A4: the stack never grows unbounded — a burst of failures keeps the most recent four. */
export const MAX_TOASTS = 4;

type ToastStore = {
  toasts: Toast[];
  push: (message: string, tone: ToastTone) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
};

let toastSeq = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  push: (message, tone) =>
    set((state) => ({ toasts: [...state.toasts, { id: `t${++toastSeq}`, message, tone }].slice(-MAX_TOASTS) })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  dismissAll: () => set({ toasts: [] }),
}));

/** Push from non-React code paths (ws handlers, async catches). Defaults to the error tone. */
export function pushToast(message: string, tone: ToastTone = "error"): void {
  useToastStore.getState().push(message, tone);
}
