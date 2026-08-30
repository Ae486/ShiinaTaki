/**
 * INPUT:  the home shell's WsClient (config.list / config.set / config.subscribe + config.changed pushes) and the
 *         shell's shown-page signal (page-visibility-store).
 * OUTPUT: useConfig() -> { entries, error, refreshing, notices, save(key, value) } — the knobs page's data seam.
 * POS:    ui/windows/home/pages/settings — the ONLY config touchpoint between the page and ws-client (hook-guidelines).
 *         Glue only: every state transition is a pure function in config-state.ts / config-gate.ts and the list itself
 *         is the shared cached-fetch seam (its persisted copy is stripped of secret-flagged knobs, see cache-persist).
 *         P1e (batch-7): the config.changed subscription stays live while the page is hidden, but the local apply is
 *         skipped and reactivation refetches once (deduped) instead of replaying deltas.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ConfigListResultSchema, type ConfigEntry, type ConfigValue } from "@taki/shared";
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible, usePageVisibilityStore } from "../../page-visibility-store.ts";
import { applyChanged, applyStored, applyVerdict, refusalMessage, refusalOf } from "./config-state.ts";
import { INITIAL_CONFIG_GATE, onConfigDelta, onConfigReactivation, type ConfigGateState } from "./config-gate.ts";

export interface ConfigView {
  entries: ConfigEntry[];
  connectionReady: boolean;
  /** A load failure (the page shows it instead of an empty knob list). */
  error: string | null;
  /** A background re-read is running over the knobs already on screen. */
  refreshing: boolean;
  /** Per-key outcome of the last save: the apply verdict, or the refusal explanation. */
  notices: Record<string, { ok: boolean; message: string }>;
  save: (key: string, value: ConfigValue | null) => Promise<void>;
  /** Re-reads the list after a load failure (batch-2 U5: every failed read gets a retry). */
  refresh: () => Promise<void>;
}

const SETTINGS_PAGE_ID = "settings";

/**
 * Reactivation: skipped deltas are covered by ONE refetch, never stacked — while a load runs the gate waits and this
 * effect re-evaluates when `refreshing` settles. It keys on the subscribed visibility value so a show re-runs it.
 */
function useBehindRefetch(input: {
  gateRef: RefObject<ConfigGateState>;
  visible: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
}): void {
  const { gateRef, visible, refreshing, refresh } = input;
  useEffect(() => {
    const decision = onConfigReactivation(gateRef.current, visible, refreshing);
    gateRef.current = decision.state;
    if (decision.refetch) void refresh();
  }, [gateRef, visible, refreshing, refresh]);
}

export function useConfig(): ConfigView {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const visible = usePageVisible(SETTINGS_PAGE_ID);
  const [notices, setNotices] = useState<ConfigView["notices"]>({});
  const gateRef = useRef<ConfigGateState>(INITIAL_CONFIG_GATE);
  const load = useMemo(() => (ready ? () => ready.configList() : null), [ready]);
  const list = useCachedFetch("config-list", load, { schema: ConfigListResultSchema, persist: true });
  const { mutate } = list;

  useEffect(() => {
    if (!ready) return;
    // Another operator surface (CLI, a second window) may edit a knob — the push keeps this list honest. The
    // subscription stays live while hidden (cheap, additive); the local apply is gated instead (batch-7 §9.2).
    // Visibility is read imperatively here: WS callbacks run outside render, so the freshest store truth is used.
    const unsubscribe = ready.onConfigChanged((changed) => {
      const decision = onConfigDelta(gateRef.current, usePageVisibilityStore.getState().activePage === SETTINGS_PAGE_ID);
      gateRef.current = decision.state;
      if (!decision.apply) return;
      mutate((prev) => ({ ...prev, entries: applyChanged(prev.entries, changed) }));
    });
    void ready.subscribeConfig().catch((cause: unknown) => console.warn("[home] config subscribe failed", cause));
    return unsubscribe;
  }, [ready, mutate]);

  // Reactivation (see useBehindRefetch): skipped deltas refetch once on show, deduped against in-flight loads.
  useBehindRefetch({ gateRef, visible, refreshing: list.refreshing, refresh: list.refresh });

  const save = useCallback(
    async (key: string, value: ConfigValue | null) => {
      if (!ready) return;
      try {
        const result = await ready.configSet({ key, value });
        mutate((prev) => ({ ...prev, entries: applyStored(prev.entries, result) }));
        setNotices((prev) => ({ ...prev, [key]: { ok: true, message: applyVerdict(result.apply) } }));
      } catch (cause) {
        const reason = refusalOf(cause);
        const message = reason ? refusalMessage(reason) : cause instanceof Error ? cause.message : String(cause);
        setNotices((prev) => ({ ...prev, [key]: { ok: false, message } }));
      }
    },
    [ready, mutate],
  );

  return {
    entries: list.data?.entries ?? [],
    connectionReady: ready !== null,
    error: list.error,
    refreshing: list.refreshing,
    notices,
    save,
    refresh: list.refresh,
  };
}
