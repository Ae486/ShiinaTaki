/**
 * INPUT:  `pet:costume-switch` Tauri events emitted by the home window's costume page + the live PetScene.
 * OUTPUT: useCostumeSwitchEvent(scene) — drives the EXISTING costume switch path from validated event payloads.
 * POS:    ui/windows/pet — the inbound half of the home→pet costume seam (the home:navigate listener is the template).
 *         The switch path itself is unchanged, so persistence, degrade and re-report behavior stay identical.
 */

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { COSTUME_SWITCH_EVENT, handleCostumeSwitch } from "@/lib/costume-switch-event.js";
import { useCostumeSwitch } from "@/features/character-import/use-costume-switch.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export function useCostumeSwitchEvent(scene: PetScene | null): void {
  const { switchTo } = useCostumeSwitch(scene);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void listen(COSTUME_SWITCH_EVENT, (event) =>
      handleCostumeSwitch(event.payload, {
        apply: (costumeId) => void switchTo(costumeId),
        warn: (message, payload) => console.warn(message, payload),
      }),
    )
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => console.error("[pet] costume-switch listener failed", error));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [switchTo]);
}
