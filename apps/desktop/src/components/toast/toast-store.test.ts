/**
 * INPUT:  push/dismiss reducer calls on the window-local toast store.
 * OUTPUT: assertions for queue ordering, per-id dismissal, dismissAll, the non-React pushToast entry, and the
 *         A4 stacking cap (oldest dropped beyond MAX_TOASTS).
 * POS:    unit test for components/toast/toast-store (D34). The host's timers/outside-click are DOM-bound (untested).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MAX_TOASTS, pushToast, useToastStore } from "./toast-store.ts";

beforeEach(() => useToastStore.getState().dismissAll());

describe("toast-store", () => {
  it("queues toasts in push order with unique ids", () => {
    pushToast("first");
    pushToast("second", "info");
    const { toasts } = useToastStore.getState();
    expect(toasts.map((t) => t.message)).toEqual(["first", "second"]);
    expect(toasts[0]?.tone).toBe("error"); // default tone
    expect(toasts[1]?.tone).toBe("info");
    expect(new Set(toasts.map((t) => t.id)).size).toBe(2);
  });

  it("dismisses one by id and all at once", () => {
    pushToast("a");
    pushToast("b");
    const first = useToastStore.getState().toasts[0];
    useToastStore.getState().dismiss(first?.id ?? "");
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["b"]);
    useToastStore.getState().dismissAll();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("caps the stack at MAX_TOASTS, dropping the oldest (A4)", () => {
    for (let i = 0; i < MAX_TOASTS + 2; i += 1) pushToast(`toast-${i}`);
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(MAX_TOASTS);
    expect(toasts.map((t) => t.message)).toEqual([
      "toast-2",
      "toast-3",
      "toast-4",
      "toast-5",
    ]);
  });
});
