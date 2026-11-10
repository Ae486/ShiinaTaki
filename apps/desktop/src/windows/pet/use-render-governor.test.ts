import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectCallback } from "react";
import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RenderGovernor, type TickerLike } from "@/renderer/render-governor.js";
import { useRenderGovernor } from "./use-render-governor.ts";

const effects = vi.hoisted(() => [] as EffectCallback[]);
vi.mock("react", () => ({ useEffect: (effect: EffectCallback) => effects.push(effect) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> { for (let step = 0; step < 10; step += 1) await Promise.resolve(); }

function harness() {
  const registration = deferred<UnlistenFn>();
  const focusRead = deferred<boolean>();
  const unlisten = vi.fn();
  let focusHandler: EventCallback<boolean> | null = null;
  const nativeWindow = {
    onFocusChanged: vi.fn((handler: EventCallback<boolean>) => { focusHandler = handler; return registration.promise; }),
    isFocused: vi.fn(() => focusRead.promise),
  };
  vi.mocked(getCurrentWindow).mockReturnValue(nativeWindow as unknown as ReturnType<typeof getCurrentWindow>);
  const documentState = { hidden: false, hasFocus: vi.fn(() => false), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("document", documentState);
  const ticker: TickerLike = {
    started: false, maxFPS: 0,
    start() { this.started = true; }, stop() { this.started = false; },
  };
  const governor = new RenderGovernor(ticker);
  useRenderGovernor(governor);
  const cleanup = effects.pop()?.();
  if (typeof cleanup !== "function") throw new Error("Missing governor cleanup");
  const event = (focused: boolean) => focusHandler?.({ event: "tauri://focus", id: 1, payload: focused });
  return { registration, focusRead, unlisten, nativeWindow, documentState, ticker, governor, cleanup, event };
}

beforeEach(() => { vi.clearAllMocks(); effects.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("render governor native focus lifetime", () => {
  it("seeds an already-unfocused loaded Pet into the existing blur tier after listening", async () => {
    const h = harness();
    expect(h.ticker.maxFPS).toBe(30);
    expect(h.nativeWindow.isFocused).not.toHaveBeenCalled();
    h.registration.resolve(h.unlisten);
    await flush();
    expect(h.nativeWindow.isFocused).toHaveBeenCalledTimes(1);
    h.focusRead.resolve(false);
    await flush();
    expect(h.ticker.maxFPS).toBe(15);
    expect(h.ticker.started).toBe(true);
    expect(h.nativeWindow.onFocusChanged).toHaveBeenCalledTimes(1);
    expect(h.documentState.addEventListener).toHaveBeenCalledExactlyOnceWith("visibilitychange", expect.any(Function));
    h.cleanup();
  });

  it.each([{ event: true, seed: false, fps: 30 }, { event: false, seed: true, fps: 15 }])(
    "keeps the newer focus event $event over the late query seed $seed", async ({ event, seed, fps }) => {
      const h = harness();
      h.registration.resolve(h.unlisten);
      await flush();
      h.event(event);
      h.focusRead.resolve(seed);
      await flush();
      expect(h.ticker.maxFPS).toBe(fps);
      h.cleanup();
    },
  );

  it("unlistens a late registration exactly once and never starts its disposed seed query", async () => {
    const h = harness();
    h.cleanup();
    h.registration.resolve(h.unlisten);
    await flush();
    h.event(false);
    h.cleanup();
    expect(h.unlisten).toHaveBeenCalledTimes(1);
    expect(h.nativeWindow.isFocused).not.toHaveBeenCalled();
    expect(h.documentState.removeEventListener).toHaveBeenCalledTimes(1);
    expect(h.ticker.maxFPS).toBe(30);
  });

  it("ignores pending read, focus callback and visibility callback after disposal", async () => {
    const h = harness();
    const visibility = h.documentState.addEventListener.mock.calls[0]?.[1] as () => void;
    h.registration.resolve(h.unlisten);
    await flush();
    h.cleanup();
    h.focusRead.resolve(false);
    h.event(false);
    h.documentState.hidden = true;
    visibility();
    await flush();
    expect(h.unlisten).toHaveBeenCalledTimes(1);
    expect(h.ticker.maxFPS).toBe(30);
    expect(h.ticker.started).toBe(true);
  });

  it("falls back to current document focus on a native query failure without adding a poll", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = harness();
    h.registration.resolve(h.unlisten);
    await flush();
    h.focusRead.reject(new Error("native read failed"));
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("initial native focus unavailable"), expect.any(Error));
    expect(h.ticker.maxFPS).toBe(15);
    expect(h.documentState.hasFocus).toHaveBeenCalledTimes(1);
    expect(h.nativeWindow.isFocused).toHaveBeenCalledTimes(1);
    h.event(true);
    expect(h.ticker.maxFPS).toBe(30);
    h.cleanup();
  });

  it("does not replace a newer native event with DOM fallback after the query fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = harness();
    h.registration.resolve(h.unlisten);
    await flush();
    h.event(true);
    h.focusRead.reject(new Error("late failure"));
    await flush();
    expect(h.ticker.maxFPS).toBe(30);
    expect(h.documentState.hasFocus).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("uses a visible fallback and breadcrumb if listener registration fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = harness();
    h.registration.reject(new Error("listener unavailable"));
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("native focus listener unavailable"), expect.any(Error));
    expect(h.ticker.maxFPS).toBe(15);
    expect(h.nativeWindow.isFocused).not.toHaveBeenCalled();
    h.cleanup();
  });

  it("does not subscribe or query before a governor exists", () => {
    useRenderGovernor(null);
    expect(effects.pop()?.()).toBeUndefined();
    expect(getCurrentWindow).not.toHaveBeenCalled();
  });
});
