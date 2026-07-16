/**
 * INPUT:  the live PetScene + the operator WsClient (connection store); ACTIVE_CHARACTER_ID.
 * OUTPUT: useInitialCostume(scene) — once connected, if the active character is imported, swaps the scene from the dev
 *         fallback model to that character's default costume (asset: URL) and re-reports its vocabulary. Runs once.
 * POS:    ui/windows/pet — the "imported vs dev" decision seam. The scene boots on the dev route (so dev always runs);
 *         this promotes it to the imported model when one exists, reusing the SAME switchCostume + avatar.report path.
 */

import { useEffect, useRef } from "react";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { costumeAssetResolver, resolveSettingsFile } from "@/lib/character-asset-url.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export function useInitialCostume(scene: PetScene | null): void {
  const client = useConnectionStore((s) => s.client);
  const connected = useConnectionStore((s) => s.status.kind === "connected");
  const promoted = useRef(false); // one-shot: the dev→imported promotion happens once per scene lifetime

  useEffect(() => {
    if (!scene || !client || !connected || promoted.current) return;
    promoted.current = true;
    void (async () => {
      try {
        const costumes = await client.characterCostumes(ACTIVE_CHARACTER_ID);
        const settingsFile = resolveSettingsFile(costumes, costumes.defaultCostume);
        if (!settingsFile) return; // imported but malformed marker — keep the dev model rather than crash
        const source = await costumeAssetResolver(ACTIVE_CHARACTER_ID, costumes.defaultCostume, settingsFile);
        const vocabulary = await scene.switchCostume(source);
        await client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...vocabulary });
      } catch {
        // Not imported (character.costumes rejects) → stay on the dev fallback model. Not an error the operator sees.
        // A mid-session import is handled by the panel's switchTo, so no retry is needed here.
      }
    })();
  }, [scene, client, connected]);
}
