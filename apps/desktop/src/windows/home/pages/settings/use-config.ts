/**
 * INPUT:  the home shell's WsClient (config.list / config.set / config.subscribe + config.changed pushes).
 * OUTPUT: useConfig() -> { entries, error, refreshing, notices, save(key, value) } — the knobs page's data seam.
 * POS:    ui/windows/home/pages/settings — the ONLY config touchpoint between the page and ws-client (hook-guidelines).
 *         Glue only: every state transition is a pure function in config-state.ts and the list itself is the shared
 *         cached-fetch seam (its persisted copy is stripped of secret-flagged knobs, see cache-persist).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfigListResultSchema, type ConfigEntry, type ConfigValue } from "@taki/shared";
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import { useHomeClient } from "../../home-client-context.ts";
import { applyChanged, applyStored, applyVerdict, refusalMessage, refusalOf } from "./config-state.ts";

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

export function useConfig(): ConfigView {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  const [notices, setNotices] = useState<ConfigView["notices"]>({});
  const load = useMemo(() => (ready ? () => ready.configList() : null), [ready]);
  const list = useCachedFetch("config-list", load, { schema: ConfigListResultSchema, persist: true });
  const { mutate } = list;

  useEffect(() => {
    if (!ready) return;
    // Another operator surface (CLI, a second window) may edit a knob — the push keeps this list honest.
    const unsubscribe = ready.onConfigChanged((changed) =>
      mutate((prev) => ({ ...prev, entries: applyChanged(prev.entries, changed) })),
    );
    void ready.subscribeConfig().catch((cause: unknown) => console.warn("[home] config subscribe failed", cause));
    return unsubscribe;
  }, [ready, mutate]);

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
