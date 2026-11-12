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
import { useSubagentActivity } from "./use-subagent-activity.ts";

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
  const activity = useSubagentActivity({ client: visible ? ready : null, characterId: state.characterId,
    childId: state.selectedId, revision: state.detail, tailSeq: state.detail?.entries.at(-1)?.seq ?? 0, entries: state.detail?.entries ?? [],
    hydrate: (seqs) => controller.recoverActivityBodies(seqs) });
  return { state, controller, activity, mediaClient: ready, connected: ready !== null,
    available: ready !== null && visible && state.fresh && !state.pending && state.requestedId === state.selectedId };
}
