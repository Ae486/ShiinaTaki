/**
 * INPUT:  the home shell's WsClient (config.list / config.set / config.subscribe + config.changed pushes).
 * OUTPUT: useConfig() -> { entries, error, save(key, value), savedNotice, refusal } — the knobs page's data seam.
 * POS:    ui/windows/home/pages/settings — the ONLY config touchpoint between the page and ws-client (hook-guidelines).
 *         Glue only: every state transition is a pure function in config-state.ts.
 */

import { useCallback, useEffect, useState } from "react";
import type { ConfigEntry, ConfigValue } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { applyChanged, applyStored, applyVerdict, refusalMessage, refusalOf } from "./config-state.ts";

export interface ConfigView {
  entries: ConfigEntry[];
  /** A load failure (the page shows it instead of an empty knob list). */
  error: string | null;
  /** Per-key outcome of the last save: the apply verdict, or the refusal explanation. */
  notices: Record<string, { ok: boolean; message: string }>;
  save: (key: string, value: ConfigValue | null) => Promise<void>;
}

export function useConfig(): ConfigView {
  const { client, status } = useHomeClient();
  const connected = status.kind === "connected";
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<ConfigView["notices"]>({});

  useEffect(() => {
    if (!client || !connected) return;
    let cancelled = false;
    // Another operator surface (CLI, a second window) may edit a knob — the push keeps this list honest.
    client.onConfigChanged((changed) => setEntries((prev) => applyChanged(prev, changed)));
    void Promise.all([client.configList(), client.subscribeConfig()])
      .then(([list]) => cancelled || setEntries(list.entries))
      .catch((cause: unknown) => cancelled || setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [client, connected]);

  const save = useCallback(
    async (key: string, value: ConfigValue | null) => {
      if (!client) return;
      try {
        const result = await client.configSet({ key, value });
        setEntries((prev) => applyStored(prev, result));
        setNotices((prev) => ({ ...prev, [key]: { ok: true, message: applyVerdict(result.apply) } }));
      } catch (cause) {
        const reason = refusalOf(cause);
        const message = reason ? refusalMessage(reason) : cause instanceof Error ? cause.message : String(cause);
        setNotices((prev) => ({ ...prev, [key]: { ok: false, message } }));
      }
    },
    [client],
  );

  return { entries, error, notices, save };
}
