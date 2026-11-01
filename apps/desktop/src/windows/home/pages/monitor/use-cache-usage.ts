/**
 * INPUT: Home's physical client, the current Monitor mode and effective page visibility.
 * OUTPUT: one disposable cache-window view and explicit retry action.
 * POS: ui/monitor — hook wiring for independent aggregate subscriptions, never a Run filter or persisted cache.
 */
import { useLayoutEffect, useMemo, useState } from "react";
import type { MonitorMode } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { CacheUsageController, INITIAL_CACHE_USAGE_VIEW } from "./cache-usage-controller.ts";

export function useCacheUsage(mode: MonitorMode) {
  const { client } = useHomeClient();
  const visible = usePageActive("monitor");
  const [view, setView] = useState(INITIAL_CACHE_USAGE_VIEW);
  const controller = useMemo(() => new CacheUsageController(setView, ACTIVE_CHARACTER_ID), []);
  useLayoutEffect(() => { controller.setVisible(visible); }, [controller, visible]);
  useLayoutEffect(() => { controller.setEnabled(mode !== "DISABLED"); }, [controller, mode]);
  useLayoutEffect(() => {
    controller.bind(client);
    return () => controller.dispose();
  }, [client, controller]);
  return { view, retry: controller.retry, connected: client !== null };
}
