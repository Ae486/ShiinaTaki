/**
 * INPUT:  a fake event target recording listeners + synthetic pointerdown/keydown/blur events.
 * OUTPUT: assertions that an outside pointerdown closes the wheel WITHOUT swallowing the event (so the stage handler
 *         underneath still runs), that an inside pointerdown does not close, that Escape and blur close, and that
 *         disposing removes every listener (no idle work while the wheel is shut).
 * POS:    unit test for features/operation-wheel/wheel-dismiss. Exempt from size caps.
 */

import { describe, expect, it, vi } from "vitest";
import { installWheelDismiss, type WheelDismissListener } from "./wheel-dismiss.ts";

type Listener = WheelDismissListener;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener: (type: string, handler: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, handler: Listener) => {
      listeners.get(type)?.delete(handler);
    },
    emit: (type: string, event: Parameters<Listener>[0]) => {
      for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
    },
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

function pointerEvent() {
  return {
    target: {},
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  };
}

describe("installWheelDismiss", () => {
  it("closes on an outside pointerdown without swallowing the event", () => {
    const target = fakeTarget();
    const close = vi.fn();
    installWheelDismiss({ target, close, isInsideWheel: () => false });
    const event = pointerEvent();
    target.emit("pointerdown", event);
    expect(close).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it("keeps the wheel open when the pointerdown lands on it", () => {
    const target = fakeTarget();
    const close = vi.fn();
    installWheelDismiss({ target, close, isInsideWheel: () => true });
    target.emit("pointerdown", pointerEvent());
    expect(close).not.toHaveBeenCalled();
  });

  it("closes on Escape only, and on window blur", () => {
    const target = fakeTarget();
    const close = vi.fn();
    installWheelDismiss({ target, close, isInsideWheel: () => false });
    target.emit("keydown", { key: "a" });
    expect(close).not.toHaveBeenCalled();
    target.emit("keydown", { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    target.emit("blur", {});
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("removes every listener on dispose", () => {
    const target = fakeTarget();
    const close = vi.fn();
    const dispose = installWheelDismiss({ target, close, isInsideWheel: () => false });
    expect(target.count()).toBeGreaterThan(0);
    dispose();
    expect(target.count()).toBe(0);
    target.emit("pointerdown", pointerEvent());
    expect(close).not.toHaveBeenCalled();
  });
});
