/**
 * INPUT: the current page's authenticated client and effective visibility.
 * OUTPUT: retained model profile read state and explicit reconciliation actions.
 * POS: Home React adapter over the reusable disposable model profile observer; no persistent cache.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { createModelProfilesController, INITIAL_MODEL_PROFILES } from "./model-profiles-controller.ts";

export function useModelProfiles(client: WsClient | null, visible: boolean) {
  const [state, setState] = useState(INITIAL_MODEL_PROFILES);
  const controller = useMemo(() => createModelProfilesController(setState), []);
  useLayoutEffect(() => {
    controller.replace(client);
    return () => controller.replace(null);
  }, [controller, client]);
  useLayoutEffect(() => {
    controller.setVisible(visible);
    return () => controller.setVisible(false);
  }, [controller, visible]);
  return { ...state, refresh: controller.refresh, accept: controller.accept };
}
