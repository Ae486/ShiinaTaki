/**
 * INPUT: Home client, Monitor mode and effective background-tab visibility
 * OUTPUT: one disposable background Monitor controller and coherent view
 * POS: ui/monitor — pre-paint visibility/connection binding, independent from normal metrics
 */
import { useLayoutEffect, useMemo, useState } from "react";
import type { MonitorMode } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { MaintenanceMonitorController, INITIAL_MAINTENANCE_VIEW } from "./maintenance-monitor-controller.ts";

export function useMaintenanceMonitor(mode: MonitorMode, active: boolean) {
  const { client } = useHomeClient();
  const visible = usePageActive("monitor") && active;
  const [view, setView] = useState(INITIAL_MAINTENANCE_VIEW);
  const controller = useMemo(() => new MaintenanceMonitorController(setView, ACTIVE_CHARACTER_ID), []);
  useLayoutEffect(() => { controller.setVisible(visible); }, [controller, visible]);
  useLayoutEffect(() => { controller.setEnabled(mode !== "DISABLED"); }, [controller, mode]);
  useLayoutEffect(() => { controller.bind(client); return () => controller.dispose(); }, [controller, client]);
  return { view, controller };
}
