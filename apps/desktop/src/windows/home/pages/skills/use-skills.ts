/**
 * INPUT: HomeClientContext's current WsClient generation
 * OUTPUT: React-bound Skills controller state/actions that retire on client replacement
 * POS:    Home Skills hook; one controller per mounted page with disposable in-memory state only
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { createSkillsController, INITIAL_SKILLS_STATE } from "./skills-controller.ts";
export function useSkills() {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const visible = usePageActive("skills");
  const [state, setState] = useState(INITIAL_SKILLS_STATE);
  const controller = useMemo(() => createSkillsController(setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => {
    controller.bind(ready);
    return () => controller.bind(null);
  }, [ready, controller]);
  return { state, controller, status, connectionReady: ready !== null };
}
