/**
 * INPUT: Home client readiness, page visibility and optional addressed navigation
 * OUTPUT: reactive private-conversation state and one generation-scoped controller
 * POS: ui/subagents — sole React transport/store seam, with no persisted private content
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { SubagentController } from "./subagent-controller.ts";
import { INITIAL_SUBAGENT_STATE } from "./subagent-state.ts";
import { useSubagentNavigation } from "./subagent-navigation.ts";

export function useSubagents() {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const visible = usePageActive("subagents");
  const target = useSubagentNavigation((state) => state.target);
  const [state, setState] = useState(INITIAL_SUBAGENT_STATE);
  const controller = useMemo(() => new SubagentController(setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => { controller.bind(ready); return () => controller.bind(null); }, [controller, ready]);
  useLayoutEffect(() => { if (target) controller.navigate(target); }, [controller, target]);
  return { state, controller, mediaClient: ready, connected: ready !== null,
    available: ready !== null && visible && state.fresh && !state.pending && state.requestedId === state.selectedId };
}
