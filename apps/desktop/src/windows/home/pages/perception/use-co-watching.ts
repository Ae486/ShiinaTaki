/**
 * INPUT: Home connection and effective Perception visibility for the ordinary chat Character
 * OUTPUT: disposable projection plus explicit Co-Watching start/stop/refresh actions
 * POS: Home Perception — React binding only; controller owns read and command lifetimes
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { openSubagentConversation } from "@/features/subagents/subagent-navigation.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { createCoWatchingController, INITIAL_CO_WATCHING_STATE } from "./co-watching-controller.ts";

export function useCoWatching() {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const visible = usePageActive("perception");
  const [state, setState] = useState(INITIAL_CO_WATCHING_STATE);
  const controller = useMemo(() => createCoWatchingController(ACTIVE_CHARACTER_ID, setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => {
    controller.replace(ready);
    return () => controller.replace(null);
  }, [controller, ready]);
  const openChild = () => {
    if (state.data?.session?.subagentId) openSubagentConversation({ characterId: ACTIVE_CHARACTER_ID,
      subagentId: state.data.session.subagentId, workInputId: state.data.session.workInputId });
  };
  return { ...state, connected: ready !== null, controller, openChild };
}
