/**
 * INPUT:  push/dismiss reducer calls on the window-local toast store.
 * OUTPUT: assertions for queue ordering, per-id dismissal, dismissAll, the non-React pushToast entry, and the
 *         A4 stacking cap, event consumption and per-operation replacement.
 * POS:    queue regressions; timer and keyboard-handler contracts have separate colocated coverage.
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

  it("consumes an exact event once, including after dismissal and host remount", () => {
    const eventKey = {};
    pushToast("saved", "success", { eventKey });
    const first = useToastStore.getState().toasts[0];
    pushToast("saved", "success", { eventKey });
    expect(useToastStore.getState().toasts).toEqual([first]);
    useToastStore.getState().dismissAll();
    pushToast("saved", "success", { eventKey });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("accepts distinct later attempts with identical copy and replaces their prior outcome", () => {
    pushToast("saved", "success", { eventKey: {}, replaceKey: "config:model" });
    const firstId = useToastStore.getState().toasts[0]?.id;
    pushToast("saved", "success", { eventKey: {}, replaceKey: "config:model" });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.id).not.toBe(firstId);
    pushToast("failed", "error", { eventKey: {}, replaceKey: "config:model" });
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(["failed"]);
  });

  it("retains independently targeted notifications and supports warning tone", () => {
    pushToast("saved", "success", { eventKey: {}, replaceKey: "config:model" });
    pushToast("attention", "warn", { eventKey: {}, replaceKey: "mcp:test:github" });
    expect(useToastStore.getState().toasts.map((toast) => toast.tone)).toEqual(["success", "warn"]);
  });
});
