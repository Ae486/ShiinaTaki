/**
 * INPUT:  the home shell's WsClient (memory.tidy / memory.status / media.usage) + ACTIVE_CHARACTER_ID.
 * OUTPUT: useOperations() -> status/usage snapshots, the tidy trigger and the attachment-purge control.
 * POS:    ui/windows/home/pages/operations — the page's ws touchpoint (hook-guidelines). Glue only: the view models
 *         live in operations-state.ts, the destructive purge in use-media-clear.ts, and both reads go through the
 *         shared cached-fetch seam so a re-read failure leaves the last counters on screen instead of blanking them.
 */

import { useCallback, useMemo, useState } from "react";
import { MediaUsageResultSchema, MemoryStatusResultSchema, type MediaUsageResult, type MemoryStatusResult, type MemoryTidyResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import { useHomeClient } from "../../home-client-context.ts";
import { useMediaClear, type MediaClearControl } from "./use-media-clear.ts";

export interface OperationsView {
  status: MemoryStatusResult | null;
  usage: MediaUsageResult | null;
  tidy: MemoryTidyResult | null;
  tidying: boolean;
  refreshing: boolean;
  clear: MediaClearControl;
  error: string | null;
  runTidy: () => Promise<void>;
}

export function useOperations(): OperationsView {
  const { client, status: connection } = useHomeClient();
  const ready = client && connection.kind === "connected" ? client : null;
  const [tidy, setTidy] = useState<MemoryTidyResult | null>(null);
  const [tidying, setTidying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLoad = useMemo(() => (ready ? () => ready.memoryStatus(ACTIVE_CHARACTER_ID) : null), [ready]);
  const usageLoad = useMemo(() => (ready ? () => ready.mediaUsage() : null), [ready]);
  const status = useCachedFetch("memory-status", statusLoad, { schema: MemoryStatusResultSchema, persist: true });
  const usage = useCachedFetch("media-usage", usageLoad, { schema: MediaUsageResultSchema, persist: true });

  const refreshStatus = status.refresh;
  const refreshUsage = usage.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshUsage()]);
  }, [refreshStatus, refreshUsage]);

  const runTidy = useCallback(async () => {
    if (!ready || tidying) return;
    setTidying(true);
    setError(null);
    try {
      setTidy(await ready.memoryTidy(ACTIVE_CHARACTER_ID));
      await refresh(); // the pass moves the tidy watermark — re-read rather than guess
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTidying(false);
    }
  }, [ready, tidying, refresh]);

  // The purge keeps the raw client: gated on `ready` a disconnected click would stick on the "clearing" phase forever,
  // whereas a rejected mediaClear() surfaces a reason and releases it.
  const clear = useMediaClear(client, () => void refresh());

  return {
    status: status.data,
    usage: usage.data,
    tidy,
    tidying,
    refreshing: status.refreshing || usage.refreshing,
    clear,
    error: error ?? status.error ?? usage.error,
    runTidy,
  };
}
