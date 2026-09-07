/**
 * INPUT:  current Home client identity, connection status, and page visibility
 * OUTPUT: one disposable Monitor controller/view binding with generation and hidden-page cleanup
 * POS:    ui/monitor — hook boundary for Core reads; no persistent cache or cross-page refresh authority
 */
import { useEffect, useMemo, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";
import { createMonitorController, INITIAL_MONITOR_STATE, type MonitorViewState } from "./monitor-controller.ts";

export function useMonitorController() {
  const { client, status } = useHomeClient();
  const visible = usePageVisible("monitor");
  const [view, setView] = useState<MonitorViewState>(INITIAL_MONITOR_STATE);
  const controller = useMemo(() => createMonitorController(setView), []);
  useEffect(() => {
    controller.bind(client);
    return () => controller.dispose();
  }, [client, controller]);
  useEffect(() => { controller.setVisible(visible); }, [controller, visible]);
  return { view, controller, visible, connectionKind: status.kind };
}
