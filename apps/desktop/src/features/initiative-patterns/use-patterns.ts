/**
 * INPUT: current Home client generation and the mounted consumer's visibility.
 * OUTPUT: reactive in-memory Pattern state and domain controller actions.
 * POS: Desktop hook seam; no component talks to WsClient and no state enters storage.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "@/windows/home/home-client-context.js";
import { usePageActive } from "@/windows/home/page-visibility-store.js";
import { PatternController } from "./pattern-controller.ts";
import { INITIAL_PATTERN_STATE } from "./pattern-state.ts";

export function usePatterns(page: "initiative" | "chat") {
  const { client, status } = useHomeClient();
  const ready = status.kind === "connected" ? client : null;
  const visible = usePageActive(page);
  const [state, setState] = useState(INITIAL_PATTERN_STATE);
  const controller = useMemo(() => new PatternController(setState), []);
  useLayoutEffect(() => controller.setVisible(visible), [controller, visible]);
  useLayoutEffect(() => { controller.bind(ready); return () => controller.bind(null); }, [controller, ready]);
  return { state, controller, available: ready !== null && visible && state.fresh && !state.pending };
}
