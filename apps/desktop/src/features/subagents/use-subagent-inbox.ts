/**
 * INPUT: actual page visibility and Home connection generation
 * OUTPUT: explicit parent-event reconciliation controls with retained query state
 * POS: ui/subagents — React binding only, no polling or persisted private content
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { EMPTY_INBOX_VIEW, SubagentInboxController } from "./subagent-inbox-controller.ts";

export function useSubagentInbox() {
  const { client, status } = useHomeClient();
  const visible = usePageActive("subagents");
  const ready = visible && status.kind === "connected" ? client : null;
  const [state, setState] = useState(EMPTY_INBOX_VIEW);
  const controller = useMemo(() => new SubagentInboxController(setState), []);
  useEffect(() => { controller.bind(ready, ACTIVE_CHARACTER_ID); return () => controller.bind(null, ACTIVE_CHARACTER_ID); }, [controller, ready]);
  return { state, controller, ready: ready !== null };
}
