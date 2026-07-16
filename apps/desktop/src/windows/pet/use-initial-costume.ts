/**
 * INPUT:  the live PetScene + the operator WsClient (connection store); ACTIVE_CHARACTER_ID; the last-worn costume
 *         remembered in localStorage.
 * OUTPUT: useInitialCostume(scene) — once connected, if the active character is imported, swaps the scene from the dev
 *         fallback model to the LAST-WORN costume (falling back to the default) and re-reports its vocabulary. Runs once.
 * POS:    ui/windows/pet — the "imported vs dev" decision seam. The scene boots on the dev route (so dev always runs);
 *         this promotes it to the imported model when one exists, reusing the SAME switchCostume + avatar.report path.
 */

import { useEffect, useRef } from "react";
import type { CharacterCostumesResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { costumeAssetResolver, resolveSettingsFile } from "@/lib/character-asset-url.js";
import { loadLastCostume } from "@/lib/last-costume.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";

// The remembered costume must still exist AND still be renderable (its pack set may have changed since last run);
// anything else falls back to the marker's default. Restart no longer snaps back to defaultCostume (B7/B19).
function pickCostume(costumes: CharacterCostumesResult): string {
  const remembered = loadLastCostume(ACTIVE_CHARACTER_ID, localStorage);
  if (remembered === null || !costumes.costumes.includes(remembered)) return costumes.defaultCostume;
  return (costumes.availability?.[remembered]?.renderable ?? true) ? remembered : costumes.defaultCostume;
}

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
        const costume = pickCostume(costumes);
        const settingsFile = resolveSettingsFile(costumes, costume);
        if (!settingsFile) return; // imported but malformed marker — keep the dev model rather than crash
        // The resolution feeds pruning so an unresolvable `..` ref never reaches the asset protocol (#18).
        const { resolution } = await client.costumeResolution(ACTIVE_CHARACTER_ID, costume);
        const source = await costumeAssetResolver({
          characterId: ACTIVE_CHARACTER_ID,
          costume,
          settingsFile,
          resolution,
        });
        const vocabulary = await scene.switchCostume(source);
        await client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...vocabulary });
      } catch {
        // Not imported (character.costumes rejects) → stay on the dev fallback model. Not an error the operator sees.
        // A mid-session import is handled by the panel's switchTo, so no retry is needed here.
      }
    })();
  }, [scene, client, connected]);
}
