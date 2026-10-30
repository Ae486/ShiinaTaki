import { afterEach, describe, expect, it, vi } from "vitest";
import { observeTextExposure } from "./text-exposure.ts";

function fixture(text = "committed reply") {
  const element = { textContent: text, isConnected: true } as HTMLElement;
  let callback!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  class Observer {
    constructor(handler: IntersectionObserverCallback) { callback = handler; }
    observe() {} disconnect = disconnect;
  }
  const changed = vi.fn();
  const exposure = observeTextExposure({ element, changed, observer: Observer as unknown as typeof IntersectionObserver });
  const rectangle: DOMRectReadOnly = { width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}) };
  const visible = (ratio: number) => callback([{ target: element, isIntersecting: ratio > 0, intersectionRatio: ratio,
    boundingClientRect: rectangle, intersectionRect: rectangle, rootBounds: null, time: 0 }], {} as IntersectionObserver);
  return { element, exposure, visible, changed, disconnect };
}
afterEach(() => { vi.useRealTimers(); });
describe("committed text exposure", () => {
  it("requires continuous half-region visibility and retires on hide without filling the gap", () => {
    vi.useFakeTimers(); const f = fixture(); f.exposure.setEnabled(true); f.visible(0.8);
    vi.advanceTimersByTime(1_999); expect(f.changed).not.toHaveBeenCalled();
    f.visible(0.4); vi.advanceTimersByTime(2_000); expect(f.changed).not.toHaveBeenCalled();
    f.visible(0.5); vi.advanceTimersByTime(2_000); expect(f.changed.mock.calls).toEqual([[true]]);
    f.exposure.setEnabled(false); expect(f.changed.mock.calls).toEqual([[true], [false]]);
    f.exposure.setEnabled(true); vi.advanceTimersByTime(1_000); f.exposure.dispose();
    vi.advanceTimersByTime(2_000); expect(f.changed).toHaveBeenCalledTimes(2); expect(f.disconnect).toHaveBeenCalledOnce();
  });
  it("does not qualify a skeleton, disconnected node or retired callback", () => {
    vi.useFakeTimers(); const f = fixture(""); f.exposure.setEnabled(true); f.visible(1);
    vi.advanceTimersByTime(2_000); expect(f.changed).not.toHaveBeenCalled();
    f.element.textContent = "late"; f.visible(1); Object.defineProperty(f.element, "isConnected", { value: false }); vi.advanceTimersByTime(2_000);
    expect(f.changed).not.toHaveBeenCalled(); f.exposure.dispose(); f.visible(1); vi.runAllTimers();
    expect(f.changed).not.toHaveBeenCalled();
  });
});
