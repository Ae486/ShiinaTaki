/**
 * INPUT: the live Pet scene and correlated Home read requests over native window events.
 * OUTPUT: actual attached-costume snapshots plus readiness/reset invalidations; never persisted selection guesses.
 * POS: Pet presentation adapter — the scene remains the sole owner of what is currently worn.
 */
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PetScene } from "@/renderer/pet-scene.js";
import { COSTUME_SCENE_REQUEST, notifyCostumeSceneChanged, publishCostumeScene, sceneRequestId } from "@/lib/costume-scene-event.js";

export function useCostumeSceneObserver(scene: PetScene | null): void {
  useEffect(() => {
    let retired = false;
    let stop: UnlistenFn | null = null;
    void listen(COSTUME_SCENE_REQUEST, ({ payload }) => {
      const requestId = sceneRequestId(payload);
      if (retired || requestId === null) return;
      void publishCostumeScene({ requestId, costumeId: scene?.reportSnapshot().costume ?? null })
        .catch((cause: unknown) => console.warn("[pet] costume scene observation undeliverable", cause));
    }).then((unlisten) => {
      if (retired) unlisten();
      else { stop = unlisten; notifyCostumeSceneChanged(); }
    }).catch((cause: unknown) => console.warn("[pet] costume scene listener unavailable", cause));
    window.addEventListener("pagehide", notifyCostumeSceneChanged);
    return () => {
      retired = true;
      stop?.();
      window.removeEventListener("pagehide", notifyCostumeSceneChanged);
      notifyCostumeSceneChanged();
    };
  }, [scene]);
}
