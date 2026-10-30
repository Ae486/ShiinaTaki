/**
 * INPUT: current Home connection and actual Monitor availability/visibility.
 * OUTPUT: reactive policy diagnostics and an explicit read retry.
 * POS: same-Monitor hook; disabled or hidden Monitor owns no data requests.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { INITIAL_POLICY_STATE, InitiativePolicyController } from "./initiative-policy-controller.ts";

export function useInitiativePolicy(enabled: boolean) {
  const { client, status } = useHomeClient();
  const visible = usePageActive("monitor");
  const ready = status.kind === "connected" ? client : null;
  const [state, setState] = useState(INITIAL_POLICY_STATE);
  const controller = useMemo(() => new InitiativePolicyController(setState), []);
  useLayoutEffect(() => controller.setActive(enabled && visible), [controller, enabled, visible]);
  useLayoutEffect(() => { controller.bind(ready); return () => controller.bind(null); }, [controller, ready]);
  return { state, refresh: () => void controller.refresh() };
}
