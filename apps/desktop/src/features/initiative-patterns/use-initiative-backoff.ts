/**
 * INPUT: restored Home client and current Monitor availability/visibility.
 * OUTPUT: backoff read view plus explicit refresh/reset actions and readiness.
 * POS: same-Monitor hook; hidden reads retire without cancelling a submitted reset.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { INITIAL_BACKOFF_STATE, InitiativeBackoffController } from "./initiative-backoff-controller.ts";

export function useInitiativeBackoff(enabled: boolean) {
  const { client, status } = useHomeClient();
  const visible = usePageActive("monitor");
  const ready = status.kind === "connected" ? client : null;
  const [state, setState] = useState(INITIAL_BACKOFF_STATE);
  const controller = useMemo(() => new InitiativeBackoffController(setState), []);
  useLayoutEffect(() => controller.setActive(enabled && visible), [controller, enabled, visible]);
  useLayoutEffect(() => { controller.bind(ready); return () => controller.bind(null); }, [controller, ready]);
  return { state, available: Boolean(ready) && enabled && visible,
    refresh: () => void controller.refresh(), reset: () => void controller.reset() };
}
