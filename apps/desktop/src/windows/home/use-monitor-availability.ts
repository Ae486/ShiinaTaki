/**
 * INPUT:  the Home client generation, typed Monitor snapshots/config changes, and requested page
 * OUTPUT: last-confirmed Monitor visibility across transient reconnects and confirmed-disabled navigation
 * POS:    ui/home — display-only availability; initial unknown grants no surface and Core still authorizes every read
 */
import { useEffect, useState } from "react";
import { MONITOR_MODE_CONFIG_KEY, MonitorModeSchema, type MonitorMode } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { PageId } from "./pages.ts";
import { useHomeStore } from "./home-store.ts";

export type MonitorAvailabilityClient = Pick<WsClient, "onConfigChanged" | "subscribeConfig" | "monitorState">;

export function useMonitorAvailability(client: MonitorAvailabilityClient | null, requested: PageId) {
  const [mode, setMode] = useState<MonitorMode | null>(null);
  const navigate = useHomeStore((state) => state.navigate);
  const resolved = resolveMonitorPageRequest(requested, mode);
  useEffect(() => observeMonitorAvailability(client, setMode), [client]);
  useEffect(() => { if (resolved !== requested) navigate(resolved); }, [navigate, requested, resolved]);
  return { mode, enabled: mode !== null && mode !== "DISABLED" };
}

export function observeMonitorAvailability(client: MonitorAvailabilityClient | null, publish: (mode: MonitorMode) => void): () => void {
  // A retired connection says nothing about the last confirmed mode. Keeping this view preserves the page/controller
  // instance while its own reads become stale; an initial null mode still leaves the optional surface hidden.
  if (!client) return () => undefined;
  let current = true;
  let changedAfterRead = false;
  const remove = client.onConfigChanged((change) => {
    if (!current || change.key !== MONITOR_MODE_CONFIG_KEY) return;
    const parsed = MonitorModeSchema.safeParse(change.value);
    if (!parsed.success) return;
    changedAfterRead = true;
    publish(parsed.data);
  });
  void client.subscribeConfig().catch(() => undefined);
  void client.monitorState().then((state) => {
    const parsed = MonitorModeSchema.safeParse(state.mode);
    if (current && !changedAfterRead && parsed.success) publish(parsed.data);
  }).catch(() => undefined);
  // A failed read is not a DISABLED fact. The connection banner/Monitor controller retain their explicit error state.
  return () => { if (current) { current = false; remove(); } };
}

export function resolveMonitorPageRequest(requested: PageId, mode: MonitorMode | null): PageId {
  return requested === "monitor" && mode === "DISABLED" ? "chat" : requested;
}
