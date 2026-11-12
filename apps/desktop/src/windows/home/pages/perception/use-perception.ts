/**
 * INPUT:  Home's authenticated client and effective Perception visibility.
 * OUTPUT: usePerception() — coherent card/pause state, real request phases and independent explicit pause actions.
 * POS:    Home Perception — React adapter over the memory-only controller; no cached pause authority or polling.
 */
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { PerceptionPauseSetParams } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { createPerceptionController, INITIAL_PERCEPTION_STATE } from "./perception-controller.ts";

export function usePerception() {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const visible = usePageActive("perception");
  const [state, setState] = useState(INITIAL_PERCEPTION_STATE);
  const controller = useMemo(() => createPerceptionController(setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => {
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const setPause = useCallback((params: PerceptionPauseSetParams) => controller.setPause(params), [controller]);
  return {
    ...state, error: state.error ?? state.pauseError, connectionReady: ready !== null,
    loading: state.kind === "loading" && state.card === null,
    refreshing: state.kind === "loading" && state.card !== null,
    refresh, setPause,
  };
}
