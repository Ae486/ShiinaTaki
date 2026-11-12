/**
 * INPUT: actual Costume-page visibility, the existing selection reducer and live request timing policy.
 * OUTPUT: one bounded current-scene read on entry/change/refresh; listeners retire when the page hides.
 * POS: Home Costume — React/Tauri adapter over the correlated presentation observer.
 */
import { useEffect, useMemo, useState, type Dispatch } from "react";
import { listen, TauriEvent, type Options, type UnlistenFn } from "@tauri-apps/api/event";
import type { TimingPolicy } from "@taki/shared";
import { COSTUME_SCENE_CHANGED, COSTUME_SCENE_SNAPSHOT, requestCostumeScene } from "@/lib/costume-scene-event.js";
import { CostumeSceneObserver } from "./costume-scene-observer.ts";
import type { CostumeSelectAction } from "./costume-select-state.ts";

export function useCostumeSceneObservation(input: {
  visible: boolean;
  dispatch: Dispatch<CostumeSelectAction>;
  currentTimingPolicy(): TimingPolicy;
}): { refresh(): void; error: string | null } {
  const { visible, dispatch, currentTimingPolicy } = input;
  const [error, setError] = useState<string | null>(null);
  const observer = useMemo(() => new CostumeSceneObserver({
    request: requestCostumeScene,
    observe: (costumeId) => dispatch({ kind: "observed", costumeId }),
    error: setError,
    timeoutMs: () => currentTimingPolicy().interactiveRpcMs,
  }), [dispatch, currentTimingPolicy]);

  useEffect(() => {
    if (!visible) return;
    dispatch({ kind: "observed", costumeId: null });
    let retired = false;
    const stops: UnlistenFn[] = [];
    const retire = (): void => { retired = true; observer.stop(); for (const stop of stops.splice(0)) stop(); };
    const register = async (event: string, handler: (payload: unknown) => void, options?: Options): Promise<void> => {
      const stop = await listen(event, ({ payload }) => { if (!retired) handler(payload); }, options);
      if (retired) stop(); else stops.push(stop);
    };
    void Promise.all([
      register(COSTUME_SCENE_SNAPSHOT, (payload) => observer.receive(payload)),
      register(COSTUME_SCENE_CHANGED, () => observer.refresh()),
      register(TauriEvent.WINDOW_DESTROYED, () => observer.unavailable(), { target: { kind: "Window", label: "pet" } }),
    ]).then(() => { if (!retired) observer.start(); }).catch(() => {
      if (retired) return;
      retire();
      setError("无法读取宠物窗口当前服装，请重新打开换装页面");
    });
    return retire;
  }, [visible, observer, dispatch]);

  return { refresh: () => observer.refresh(), error };
}
