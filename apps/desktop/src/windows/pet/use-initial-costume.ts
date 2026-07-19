/**
 * INPUT:  the live PetScene + the operator WsClient (connection store); ACTIVE_CHARACTER_ID; the last-worn costume
 *         remembered in localStorage.
 * OUTPUT: useInitialCostume(scene) — once connected, if the active character is imported, swaps the scene from the dev
 *         fallback model to the LAST-WORN costume; a failed/wedged remembered costume FALLS BACK to the default
 *         (timeout-guarded — the packaged pet must never boot into a permanent invisible model-less state). Runs once.
 * POS:    ui/windows/pet — the "imported vs dev" decision seam. The scene boots on the dev route (so dev always runs);
 *         this promotes it to the imported model when one exists, reusing the SAME switchCostume + avatar.report path.
 */

import { useEffect, useRef } from "react";
import type { CharacterCostumesResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { resolveSettingsFile } from "@/lib/character-asset-url.js";
import { loadLastCostume } from "@/lib/last-costume.js";
import { resolveSwitchReport } from "@/lib/resolve-switch-report.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";

const PROMOTE_TIMEOUT_MS = 30_000;

// The remembered costume must still exist AND still be renderable (its pack set may have changed since last run);
// anything else falls back to the marker's default. Restart no longer snaps back to defaultCostume (B7/B19).
function pickCostume(costumes: CharacterCostumesResult): string {
  const remembered = loadLastCostume(ACTIVE_CHARACTER_ID, localStorage);
  if (remembered === null || !costumes.costumes.includes(remembered)) return costumes.defaultCostume;
  return (costumes.availability?.[remembered]?.renderable ?? true) ? remembered : costumes.defaultCostume;
}

// One promotion attempt: resolve the settings file, then the shared switch+report dance (prune-load via switchCostume,
// re-report the re-read vocabulary through the existing avatar.report).
async function promote(deps: { client: WsClient; scene: PetScene; costumes: CharacterCostumesResult; costume: string }): Promise<void> {
  const settingsFile = resolveSettingsFile(deps.costumes, deps.costume);
  if (!settingsFile) throw new Error(`no settings file for costume ${deps.costume}`);
  await resolveSwitchReport({ client: deps.client, scene: deps.scene, costume: deps.costume, settingsFile, timeoutMs: PROMOTE_TIMEOUT_MS });
}

export function useInitialCostume(scene: PetScene | null): void {
  const client = useConnectionStore((s) => s.client);
  const connected = useConnectionStore((s) => s.status.kind === "connected");
  const promoted = useRef(false); // one-shot: the dev→imported promotion happens once per scene lifetime

  useEffect(() => {
    if (!scene || !client || !connected || promoted.current) return;
    promoted.current = true;
    void (async () => {
      let costumes: CharacterCostumesResult;
      try {
        costumes = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      } catch {
        return; // not imported (character.costumes rejects) → stay on the dev fallback model; not an operator error.
      }
      const costume = pickCostume(costumes);
      try {
        await promote({ client, scene, costumes, costume });
      } catch (cause) {
        // The remembered costume wedged/failed at boot (the roaming C3 hang): fall back to the default so the pet
        // NEVER stays invisibly model-less. Logged, not silent — this exact silence cost a full diagnosis round.
        console.warn(`[initial-costume] ${costume} failed; falling back to ${costumes.defaultCostume}`, cause);
        if (costume === costumes.defaultCostume) return;
        await promote({ client, scene, costumes, costume: costumes.defaultCostume }).catch((fallbackCause: unknown) => {
          console.error(`[initial-costume] default costume ${costumes.defaultCostume} also failed`, fallbackCause);
        });
      }
    })();
  }, [scene, client, connected]);
}
