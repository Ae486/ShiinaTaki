/**
 * INPUT: Home's authenticated operator client and effective Chat page visibility
 * OUTPUT: reactive invitation/session state and explicit same-revision commands
 * POS: Desktop Co-Watching — React lifecycle only; no timer or local consent state
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { INITIAL_INVITATION_STATE, InvitationController } from "./invitation-controller.ts";
import { openSubagentConversation } from "@/features/subagents/subagent-navigation.js";

export function useCoWatchingInvitation() {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const visible = usePageActive("chat");
  const [state, setState] = useState(INITIAL_INVITATION_STATE);
  const controller = useMemo(() => new InvitationController(ACTIVE_CHARACTER_ID, setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => { controller.replace(ready); return () => controller.replace(null); }, [controller, ready]);
  const openChild = () => {
    if (state.session?.subagentId) openSubagentConversation({ characterId: ACTIVE_CHARACTER_ID,
      subagentId: state.session.subagentId, workInputId: state.session.workInputId });
  };
  return { state, controller, openChild, connected: ready !== null, available: ready !== null && visible && !state.pending && !state.stale };
}
