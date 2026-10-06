/**
 * INPUT: Home-owned authenticated client generations.
 * OUTPUT: transition read model and explicit confirmation actions.
 * POS: ui/operations — preserves the last good frame; owns no operation ledger or retry scheduler.
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { createMemoryTransitionsController, INITIAL_TRANSITIONS } from "./memory-transitions-controller.ts";

export function useMemoryTransitions() {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const [state, setState] = useState(INITIAL_TRANSITIONS);
  const controller = useMemo(() => createMemoryTransitionsController(setState), []);
  useEffect(() => { controller.replace(ready); return () => controller.replace(null); }, [controller, ready]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...state, connectionReady: ready !== null, refresh: controller.refresh, openPreview: controller.preview,
    confirm: controller.confirm, dismiss: controller.dismiss, cancel: controller.cancel };
}
export type MemoryTransitionsView = ReturnType<typeof useMemoryTransitions>;
