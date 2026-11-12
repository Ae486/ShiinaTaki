/**
 * INPUT: Home connection lifecycle and actual page visibility.
 * OUTPUT: disposable setup controller plus semantic navigation actions.
 * POS: Desktop setup hook; window-local state cannot enable Core policy itself.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { useHomeStore } from "@/windows/home/home-store.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { INITIAL_SETUP_STATE, InitiativeSetupController } from "./initiative-setup-controller.ts";

export function useInitiativeSetup(page: "initiative" | "chat") {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const visible = usePageActive(page);
  const navigate = useHomeStore((state) => state.navigate);
  const [state, setState] = useState(INITIAL_SETUP_STATE);
  const controller = useMemo(() => new InitiativeSetupController(setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => { controller.bind(ready); return () => controller.bind(null); }, [controller, ready]);
  return { state, controller, available: ready !== null && visible && state.fresh && !state.pending,
    openSkills: () => navigate("skills"), openSettings: () => navigate("settings"), openPatterns: () => navigate("initiative") };
}
