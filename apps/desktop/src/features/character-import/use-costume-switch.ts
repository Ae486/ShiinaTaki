/**
 * INPUT:  the live PetScene (its switchCostume) + the operator WsClient (from the connection store); ACTIVE_CHARACTER_ID.
 * OUTPUT: useCostumeSwitch(scene) -> { costumes, current, isSwitching, error, switchTo, refresh } for the operator panel.
 * POS:    ui/features/character-import — the ONLY costume touchpoint between the panel UI and ws-client/scene
 *         (hook-guidelines). A switch reloads the costume in the renderer then re-reports its vocab via the EXISTING
 *         avatar.report (arch §6b — no costume.switch WS method). Components never call ws-client directly.
 */

import { useCallback, useEffect, useState } from "react";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { costumeAssetResolver } from "@/lib/character-asset-url.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import type { PetScene } from "@/renderer/pet-scene.js";

export interface CostumeSwitch {
  costumes: string[];
  current: string | null;
  isSwitching: boolean;
  error: string | null;
  switchTo: (costume: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// Reload the costume in the renderer, then re-report the re-read vocabulary through the existing avatar.report so the
// Core's per-character vocab (and next turn's prompt) tracks the new costume (arch §6b). Returns nothing; throws up.
async function applySwitch(deps: { client: WsClient; scene: PetScene; costume: string; settingsFile: string }): Promise<void> {
  const source = await costumeAssetResolver(ACTIVE_CHARACTER_ID, deps.costume, deps.settingsFile);
  const vocabulary = await deps.scene.switchCostume(source);
  await deps.client.reportAvatar({ characterId: ACTIVE_CHARACTER_ID, ...vocabulary });
}

export function useCostumeSwitch(scene: PetScene | null): CostumeSwitch {
  const client = useConnectionStore((s) => s.client);
  const connected = useConnectionStore((s) => s.status.kind === "connected");
  const [state, setState] = useState<{ costumes: string[]; files: Record<string, string>; current: string | null }>(
    { costumes: [], files: {}, current: null },
  );
  const [isSwitching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      setState((prev) => ({ costumes: result.costumes, files: result.settingsFilesByCostume, current: prev.current ?? result.defaultCostume }));
    } catch {
      setState({ costumes: [], files: {}, current: null }); // no imported character yet (dev route) — empty switcher
    }
  }, [client]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const switchTo = useCallback(
    async (costume: string) => {
      const settingsFile = state.files[costume];
      if (!client || !scene || !settingsFile) return;
      setSwitching(true);
      setError(null);
      try {
        await applySwitch({ client, scene, costume, settingsFile });
        setState((prev) => ({ ...prev, current: costume }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSwitching(false);
      }
    },
    [client, scene, state.files],
  );

  return { costumes: state.costumes, current: state.current, isSwitching, error, switchTo, refresh };
}
