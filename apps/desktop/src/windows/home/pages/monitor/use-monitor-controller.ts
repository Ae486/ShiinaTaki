/**
 * INPUT:  current Home client identity, connection status, and page visibility
 * OUTPUT: pre-paint Monitor controller/view reconciliation with generation and hidden-page cleanup
 * POS:    ui/monitor — hook boundary for Core reads; no persistent cache or cross-page refresh authority
 */
import { useLayoutEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorViewState } from "./monitor-controller.ts";

export function useMonitorController() {
  const { client, status } = useHomeClient();
  const visible = usePageVisible("monitor");
  const [view, setView] = useState<MonitorViewState>(INITIAL_MONITOR_STATE);
  const controller = useMemo(() => createMonitorController(setView), []);
  // Gate the first bind while hidden, and flush a returning controller's current authority before reveal paints.
  useLayoutEffect(() => { controller.setVisible(visible); }, [controller, visible]);
  useLayoutEffect(() => {
    controller.bind(client);
    return () => controller.dispose();
  }, [client, controller]);
  return { view, controller, visible, connectionKind: status.kind };
}
