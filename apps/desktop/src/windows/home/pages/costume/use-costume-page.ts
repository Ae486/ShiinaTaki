/**
 * INPUT:  the home shell's WsClient (character.costumes), the remembered costume in localStorage, and the pet window's
 *         pet:costume-result reports.
 * OUTPUT: useCostumePage() -> { view, listError, loading, refreshing, error, selected, pending, select, cancel, refresh }.
 * POS:    ui/windows/home/pages/costume — the ONLY ws/event touchpoint of the page. A pick COMMANDS the pet window (the
 *         live PetScene lives there) and the pet's REPORT drives every state move; the deadline here is the page's own
 *         guarantee that a pet which never answers cannot wedge it.
 */

import { useCallback, useEffect, useMemo, useReducer, type Dispatch } from "react";
import { CharacterCostumesResultSchema, type TimingPolicy } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import {
  COSTUME_RESULT_EVENT,
  handleCostumeResult,
  requestCostumeCancel,
  requestCostumeSwitch,
} from "@/lib/costume-switch-event.js";
import { loadLastCostume } from "@/lib/last-costume.js";
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import { useTauriEvent } from "@/lib/use-tauri-event.js";
import { useHomeClient } from "../../home-client-context.ts";
import { costumeListView, type CostumeListView } from "./costume-view.ts";
import { IDLE, reduceCostumeSelect, type CostumeSelectAction } from "./costume-select-state.ts";
import { startCostumeResultDeadline } from "./costume-result-deadline.ts";

const EMPTY: CostumeListView = { rows: [], missingPacks: [], current: null };

export interface CostumePageView {
  view: CostumeListView;
  connectionReady: boolean;
  /** The list could not be re-read; the previous list stays on screen behind this message. */
  listError: string | null;
  loading: boolean;
  refreshing: boolean;
  /** The last switch failure (or the deadline), named for the operator. */
  error: string | null;
  /** The costume the pet is confirmed to wear — never the one just clicked. */
  selected: string | null;
  /** The costume mid-switch: that row alone shows the indicator + Cancel. */
  pending: string | null;
  select: (costumeId: string) => Promise<void>;
  cancel: () => void;
  refresh: () => Promise<void>;
}

/** The page's own guarantee: a pet that never answers still releases the pending row (nothing else bounds that wait). */
function useResultDeadline(
  pending: string | null,
  dispatch: Dispatch<CostumeSelectAction>,
  currentTimingPolicy: () => TimingPolicy,
): void {
  useEffect(() => {
    if (pending === null) return;
    return startCostumeResultDeadline(pending, currentTimingPolicy, (costumeId) =>
      dispatch({ kind: "timeout", costumeId }),
    );
  }, [pending, dispatch, currentTimingPolicy]);
}

export function useCostumePage(): CostumePageView {
  const { client, status, currentTimingPolicy } = useHomeClient();
  const connected = status.kind === "connected";
  const load = useMemo(() => (client && connected ? () => client.characterCostumes(ACTIVE_CHARACTER_ID) : null), [client, connected]);
  const costumes = useCachedFetch("costume-list", load, { schema: CharacterCostumesResultSchema, persist: true });
  const [state, dispatch] = useReducer(reduceCostumeSelect, IDLE);
  const { pending } = state;

  const view = useMemo(
    () => (costumes.data ? costumeListView(costumes.data, loadLastCostume(ACTIVE_CHARACTER_ID, localStorage)) : EMPTY),
    [costumes.data],
  );

  useTauriEvent(COSTUME_RESULT_EVENT, (payload) =>
    handleCostumeResult(payload, {
      apply: (result) => dispatch({ kind: "result", result }),
      warn: (message, dropped) => console.warn(message, dropped),
    }),
  );

  useResultDeadline(pending, dispatch, currentTimingPolicy);

  const select = useCallback(
    async (costumeId: string) => {
      dispatch({ kind: "request", costumeId });
      if (pending !== null) return; // the reducer explains the busy click; the wire stays quiet
      try {
        await requestCostumeSwitch(costumeId);
      } catch (cause) {
        dispatch({ kind: "undeliverable", costumeId, reason: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    [pending],
  );

  // Cancel releases this page FIRST and tells the pet second: an undeliverable cancel must still un-wedge the UI (#75).
  const cancel = useCallback(() => {
    if (pending === null) return;
    dispatch({ kind: "cancel" });
    void requestCostumeCancel(pending).catch((cause: unknown) => console.warn("[home] costume cancel undeliverable", cause));
  }, [pending]);

  return {
    view,
    connectionReady: client !== null && connected,
    listError: costumes.error,
    loading: costumes.loading,
    refreshing: costumes.refreshing,
    error: state.error,
    selected: state.selected ?? view.current,
    pending,
    select,
    cancel,
    refresh: costumes.refresh,
  };
}
