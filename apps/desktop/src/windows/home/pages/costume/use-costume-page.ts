/**
 * INPUT:  the home shell's WsClient (character.costumes) + the remembered costume in localStorage.
 * OUTPUT: useCostumePage() -> { view, error, selected, select(costumeId), refresh } — the costume page's data seam.
 * POS:    ui/windows/home/pages/costume — the ONLY ws/event touchpoint of the page. A pick COMMANDS the pet window
 *         (the live PetScene lives there); the pet's existing switch path stays the single executor and persister.
 */

import { useCallback, useEffect, useState } from "react";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { requestCostumeSwitch } from "@/lib/costume-switch-event.js";
import { loadLastCostume } from "@/lib/last-costume.js";
import { useHomeClient } from "../../home-client-context.ts";
import { costumeListView, type CostumeListView } from "./costume-view.ts";

const EMPTY: CostumeListView = { rows: [], missingPacks: [], current: null };

export interface CostumePageView {
  view: CostumeListView;
  error: string | null;
  /** The costume this page last commanded — the pet window owns what is actually worn. */
  selected: string | null;
  select: (costumeId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCostumePage(): CostumePageView {
  const { client, status } = useHomeClient();
  const connected = status.kind === "connected";
  const [view, setView] = useState<CostumeListView>(EMPTY);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.characterCostumes(ACTIVE_CHARACTER_ID);
      setView(costumeListView(result, loadLastCostume(ACTIVE_CHARACTER_ID, localStorage)));
    } catch {
      setView(EMPTY); // no imported character yet (dev route) — an empty switcher, not an error banner
    }
  }, [client]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const select = useCallback(async (costumeId: string) => {
    setError(null);
    try {
      await requestCostumeSwitch(costumeId);
      setSelected(costumeId);
    } catch (cause) {
      // The pet window may be closed or the event undeliverable — say so instead of leaving a dead click.
      setError(`无法通知宠物窗口换装：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, []);

  return { view, error, selected, select, refresh };
}
