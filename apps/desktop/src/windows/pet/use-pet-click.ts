/**
 * INPUT:  the loaded PetScene + a click at canvas-local px (from use-pet-drag's click seam).
 * OUTPUT: usePetClick(scene) -> onClick(x, y); plays the hit region's reaction and opens the chat bubble on a body click.
 * POS:    ui/windows/pet — the click-precedence rule lives here (one place): EVERY click plays its region reaction
 *         (F4); a click OFF the head additionally opens the bubble (F2). A head poke teases without starting a chat.
 */

import { useCallback } from "react";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useInteractionStore } from "@/stores/interaction-store.js";

export function usePetClick(scene: PetScene | null): (x: number, y: number) => void {
  const setBubbleOpen = useInteractionStore((s) => s.setBubbleOpen);

  return useCallback(
    (x, y) => {
      if (!scene) return;
      const region = scene.handleClick(x, y); // fires the region reaction, returns the region (null if off-model)
      // Opening reveals the current read projection. Resetting here would erase a reply that continued while closed.
      if (region !== null && region !== "head" && !useInteractionStore.getState().bubbleOpen) {
        setBubbleOpen(true);
      }
    },
    [scene, setBubbleOpen],
  );
}
