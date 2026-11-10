/**
 * INPUT:  Home's current config client plus the effective Settings page visibility.
 * OUTPUT: guarded cached config reads with an acknowledged observer, visible gap feedback and field change epochs.
 * POS:    Home Settings — React wiring; config-observer owns observation and useCachedFetch owns snapshot lifetime.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfigListResultSchema, type ConfigListResult } from "@taki/shared";
import { useCachedFetch, type CachedFetch } from "@/lib/use-cached-fetch.js";
import type { WsClient } from "@/lib/ws-client.js";
import { isPageActive } from "../../page-visibility-store.ts";
import { applyChanged } from "./config-state.ts";
import { createConfigObserver } from "./config-observer.ts";

export function useConfigRead(client: WsClient | null, visible: boolean) {
  const listRef = useRef<CachedFetch<ConfigListResult> | null>(null);
  const [observationGap, setObservationGap] = useState(true);
  const observer = useMemo(() => client ? createConfigObserver({
    client,
    visible: () => isPageActive("settings"),
    apply: (change) => listRef.current?.mutate((previous) => ({ ...previous, entries: applyChanged(previous.entries, change) })),
    demand: () => listRef.current?.invalidate() ?? Promise.resolve(),
    gap: setObservationGap,
  }) : null, [client]);
  // Register before any subscription/read effect so a baseline cannot miss an intervening notification.
  useEffect(() => observer?.start(), [observer]);
  const list = useCachedFetch("config-list", observer?.read ?? null, {
    schema: ConfigListResultSchema, persist: true, enabled: visible, automatic: false,
  });
  listRef.current = list;
  useEffect(() => {
    if (!observer) setObservationGap(true);
    observer?.setVisible(visible);
  }, [observer, visible]);
  return { ...list, observationGap, versionOf: observer?.versionOf ?? (() => 0) };
}
