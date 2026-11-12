/**
 * INPUT: current Home connection and actual document visibility
 * OUTPUT: persistent attention presentation independent of the selected Home page
 * POS: ui/subagents — lightweight window binding; private transcripts remain selected-page owned
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageVisibilityStore } from "@/windows/home/page-visibility-store.js";
import { pushToast } from "@/components/toast/toast-store.js";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { EMPTY_ATTENTION_VIEW, SubagentAttentionController } from "./subagent-attention-controller.ts";

export function useSubagentAttention() {
  const { client, status } = useHomeClient();
  const visible = usePageVisibilityStore((state) => state.documentVisible);
  const ready = status.kind === "connected" ? client : null;
  const [state, setState] = useState(EMPTY_ATTENTION_VIEW);
  const controller = useMemo(() => new SubagentAttentionController(setState,
    (message, eventKey) => pushToast(message, "warn", { eventKey, replaceKey: "subagent-attention" })), []);
  useEffect(() => { controller.setVisible(visible); }, [controller, visible]);
  useEffect(() => { controller.bind(ready, ACTIVE_CHARACTER_ID); return () => controller.bind(null, ACTIVE_CHARACTER_ID); }, [controller, ready]);
  return { state, controller };
}
