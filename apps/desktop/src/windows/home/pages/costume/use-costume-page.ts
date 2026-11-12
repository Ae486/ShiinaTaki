/**
 * INPUT:  Home client, effective page visibility, remembered costume and validated Pet result events.
 * OUTPUT: demand-driven costume reads plus independently owned switch/cancel/result/deadline state.
 * POS:    Home Costume — hiding retires reads only; the existing Pet scene remains the executor and result authority.
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
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import { useTauriEvent } from "@/lib/use-tauri-event.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { costumeListView, type CostumeListView } from "./costume-view.ts";
import { IDLE, reduceCostumeSelect, type CostumeSelectAction } from "./costume-select-state.ts";
import { startCostumeResultDeadline } from "./costume-result-deadline.ts";
import { useCostumeSceneObservation } from "./use-costume-scene-observation.ts";

const EMPTY: CostumeListView = { rows: [], missingPacks: [] };

export interface CostumePageView {
  view: CostumeListView;
  hasSnapshot: boolean;
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
  invalidate: () => Promise<void>;
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

function applyCostumeResult(payload: unknown, actions: {
  dispatch: Dispatch<CostumeSelectAction>; invalidate(): Promise<void>; observe(): void;
}): void {
  handleCostumeResult(payload, {
    apply: (result) => {
      actions.dispatch({ kind: "result", result });
      if (result.phase === "succeeded") actions.observe();
      void actions.invalidate();
    },
    warn: (message, dropped) => console.warn(message, dropped),
  });
}

export function useCostumePage(): CostumePageView {
  const { client, status, currentTimingPolicy } = useHomeClient();
  const connected = status.kind === "connected";
  const visible = usePageActive("costume");
  const load = useMemo(() => (client && connected ? () => client.characterCostumes(ACTIVE_CHARACTER_ID) : null), [client, connected]);
  const costumes = useCachedFetch("costume-list", load, { schema: CharacterCostumesResultSchema, persist: true, enabled: visible });
  const [state, dispatch] = useReducer(reduceCostumeSelect, IDLE);
  const { pending } = state;
  const observation = useCostumeSceneObservation({ visible, dispatch, currentTimingPolicy });

  const view = useMemo(
    () => (costumes.data ? costumeListView(costumes.data) : EMPTY),
    [costumes.data],
  );

  useTauriEvent(COSTUME_RESULT_EVENT, (payload) => applyCostumeResult(payload, {
    dispatch, invalidate: costumes.invalidate, observe: observation.refresh,
  }));

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
    hasSnapshot: costumes.data !== null,
    connectionReady: client !== null && connected,
    listError: costumes.error,
    loading: costumes.loading,
    refreshing: costumes.refreshing,
    error: state.error ?? observation.error,
    selected: state.selected,
    pending,
    select,
    cancel,
    refresh: async () => { observation.refresh(); await costumes.refresh(); },
    invalidate: costumes.invalidate,
  };
}
