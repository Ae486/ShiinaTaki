import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectCallback } from "react";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";
import { listen, emitTo, TauriEvent, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { COSTUME_SCENE_CHANGED, COSTUME_SCENE_SNAPSHOT } from "@/lib/costume-scene-event.js";
import { IDLE, reduceCostumeSelect, type CostumeSelectAction } from "./costume-select-state.ts";
import { useCostumeSceneObservation } from "./use-costume-scene-observation.ts";

const react = vi.hoisted(() => ({ effects: [] as EffectCallback[], error: vi.fn() }));
vi.mock("react", () => ({
  useMemo: <T>(factory: () => T) => factory(),
  useState: () => [null, react.error],
  useEffect: (effect: EffectCallback) => react.effects.push(effect),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(), emitTo: vi.fn(async () => undefined), TauriEvent: { WINDOW_DESTROYED: "tauri://destroyed" },
}));

async function flush(): Promise<void> { for (let step = 0; step < 12; step += 1) await Promise.resolve(); }

function harness() {
  let state = IDLE;
  const handlers = new Map<string, EventCallback<unknown>>();
  const stops = new Map<string, UnlistenFn>();
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    handlers.set(event, handler); const stop = vi.fn(); stops.set(event, stop); return stop;
  });
  const mount = () => {
    useCostumeSceneObservation({ visible: true, currentTimingPolicy: () => TIMING_POLICY_DEVELOPMENT_DEFAULTS,
      dispatch: (action: CostumeSelectAction) => { state = reduceCostumeSelect(state, action); } });
    const cleanup = react.effects.pop()?.();
    if (typeof cleanup !== "function") throw new Error("No visible-page observation cleanup");
    return cleanup;
  };
  const receive = (costumeId: string | null) => {
    const request = vi.mocked(emitTo).mock.lastCall?.[2] as { requestId: string };
    handlers.get(COSTUME_SCENE_SNAPSHOT)?.({ event: COSTUME_SCENE_SNAPSHOT, id: 1, payload: { ...request, costumeId } });
  };
  return { mount, receive, state: () => state, stops, handlers };
}

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); react.effects.length = 0; });
afterEach(() => vi.useRealTimers());

describe("native scene observation listener lifetime", () => {
  it("observes independently of Core and clears observation/listeners on hide", async () => {
    const h = harness();
    const cleanup = h.mount();
    expect(emitTo).not.toHaveBeenCalled();
    await flush();
    h.receive("worn-with-core-offline");
    expect(h.state().selected).toBe("worn-with-core-offline");
    expect(listen).toHaveBeenCalledWith(TauriEvent.WINDOW_DESTROYED, expect.any(Function),
      { target: { kind: "Window", label: "pet" } });
    cleanup();
    expect(h.state().selected).toBeNull();
    for (const stop of h.stops.values()) expect(stop).toHaveBeenCalledTimes(1);
    h.receive("stale-after-hide");
    expect(h.state().selected).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not restore A after hidden Pet changed and re-entry listener registration fails", async () => {
    const h = harness();
    const firstCleanup = h.mount();
    await flush();
    h.receive("A");
    firstCleanup();
    expect(h.state().selected).toBeNull();
    const registeredStop = vi.fn(), lateStop = vi.fn();
    let finishLate!: (stop: UnlistenFn) => void;
    const late = new Promise<UnlistenFn>((resolve) => { finishLate = resolve; });
    vi.mocked(listen).mockImplementation((event) => {
      if (event === COSTUME_SCENE_SNAPSHOT) return Promise.reject(new Error("listener unavailable"));
      if (event === COSTUME_SCENE_CHANGED) return Promise.resolve(registeredStop);
      return late;
    });
    const secondCleanup = h.mount();
    await flush();
    expect(h.state().selected).toBeNull();
    expect(registeredStop).toHaveBeenCalledTimes(1);
    expect(react.error).toHaveBeenLastCalledWith(expect.stringContaining("无法读取"));
    finishLate(lateStop);
    await flush();
    expect(lateStop).toHaveBeenCalledTimes(1);
    expect(emitTo).toHaveBeenCalledTimes(1); // Only the first valid lifetime issued a request.
    secondCleanup();
    expect(registeredStop).toHaveBeenCalledTimes(1);
    expect(lateStop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
