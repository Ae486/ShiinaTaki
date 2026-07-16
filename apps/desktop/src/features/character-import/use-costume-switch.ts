/**
 * INPUT:  the live PetScene (its switchCostume) + the operator WsClient (from the connection store); ACTIVE_CHARACTER_ID.
 * OUTPUT: useCostumeSwitch(scene) -> { costumes (renderable first), availability, missingPacksUnion, current,
 *         isSwitching, error, switchTo, refresh } for the operator panel.
 * POS:    ui/features/character-import — the ONLY costume touchpoint between the panel UI and ws-client/scene
 *         (hook-guidelines). A switch fetches the costume's external-ref resolution, reloads it in the renderer, then
 *         re-reports vocab via the EXISTING avatar.report (arch §6b). Components never call ws-client directly.
 */

import { useCallback, useEffect, useState } from "react";
import type { CharacterCostumesResult, CostumeAvailability } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { costumeAssetResolver } from "@/lib/character-asset-url.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export interface CostumeSwitch {
  costumes: string[]; // renderable first (stable within each half) — the panel renders them in this order
  availability: Record<string, CostumeAvailability>;
  missingPacksUnion: string[]; // owners whose packs would unlock/complete costumes — feeds the panel's notice row
  current: string | null;
  isSwitching: boolean;
  error: string | null;
  switchTo: (costume: string) => Promise<void>;
  refresh: () => Promise<void>;
}

interface CostumesState {
  costumes: string[];
  files: Record<string, string>;
  availability: Record<string, CostumeAvailability>;
  current: string | null;
}

const EMPTY: CostumesState = { costumes: [], files: {}, availability: {}, current: null };

function toState(result: CharacterCostumesResult, current: string | null): CostumesState {
  const availability = result.availability ?? {};
  const rank = (id: string): number => (availability[id]?.renderable === false ? 1 : 0);
  return {
    costumes: [...result.costumes].sort((a, b) => rank(a) - rank(b)),
    files: result.settingsFilesByCostume,
    availability,
    current: current ?? result.defaultCostume,
  };
}

function packsUnion(availability: Record<string, CostumeAvailability>): string[] {
  return [...new Set(Object.values(availability).flatMap((entry) => entry.missingPacks))].sort();
}

// Fetch the costume's external-ref resolution, reload it in the renderer, then re-report the re-read vocabulary
// through the existing avatar.report so the Core's per-character vocab (and next turn's prompt) tracks the new
// costume (arch §6b). Returns nothing; throws up.
async function applySwitch(deps: { client: WsClient; scene: PetScene; costume: string; settingsFile: string }): Promise<void> {
  const { resolution } = await deps.client.costumeResolution(ACTIVE_CHARACTER_ID, deps.costume);
  const source = await costumeAssetResolver({
    characterId: ACTIVE_CHARACTER_ID,
    costume: deps.costume,
    settingsFile: deps.settingsFile,
    resolution,
  });
  const vocabulary = await deps.scene.switchCostume(source);
  await deps.client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...vocabulary });
}

export function useCostumeSwitch(scene: PetScene | null): CostumeSwitch {
  const client = useConnectionStore((s) => s.client);
  const connected = useConnectionStore((s) => s.status.kind === "connected");
  const [state, setState] = useState<CostumesState>(EMPTY);
  const [isSwitching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      setState((prev) => toState(result, prev.current));
    } catch {
      setState(EMPTY); // no imported character yet (dev route) — empty switcher
    }
  }, [client]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const switchTo = useCallback(
    async (costume: string) => {
      const settingsFile = state.files[costume];
      // The panel disables unrenderable rows; this guard makes the no-op authoritative rather than cosmetic.
      if (!client || !scene || !settingsFile || state.availability[costume]?.renderable === false) return;
      setSwitching(true);
      setError(null);
      try {
        await applySwitch({ client, scene, costume, settingsFile });
        setState((prev) => ({ ...prev, current: costume }));
      } catch (cause) {
        setError(`${costume}: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        setSwitching(false);
      }
    },
    [client, scene, state.files, state.availability],
  );

  return {
    costumes: state.costumes,
    availability: state.availability,
    missingPacksUnion: packsUnion(state.availability),
    current: state.current,
    isSwitching,
    error,
    switchTo,
    refresh,
  };
}
