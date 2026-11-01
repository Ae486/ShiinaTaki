/**
 * INPUT:  Home client, effective page visibility and the existing cached memory/storage read seam.
 * OUTPUT: independent resource states/retries plus tidy and attachment-clear controls.
 * POS:    Home Operations — demand coordination only; mutation hooks retain their own locks and outcomes while hidden.
 */

import { useCallback, useMemo } from "react";
import { MediaUsageResultSchema, MemoryStatusResultSchema, type MediaUsageResult, type MemoryStatusResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageActive } from "../../page-visibility-store.ts";
import { useMediaClear, type MediaClearControl } from "./use-media-clear.ts";
import { useMemoryTidy } from "./use-memory-tidy.ts";
import type { MemoryTidyState } from "./memory-tidy-controller.ts";

export interface OperationsView extends MemoryTidyState {
  status: MemoryStatusResult | null;
  usage: MediaUsageResult | null;
  statusLoading: boolean;
  usageLoading: boolean;
  statusError: string | null;
  usageError: string | null;
  refreshStatus(): Promise<void>;
  refreshUsage(): Promise<void>;
  connectionReady: boolean;
  refreshing: boolean;
  clear: MediaClearControl;
  /** Re-reads both snapshots after a load failure (batch-2 U5: every failed read gets a retry). */
  refresh: () => Promise<void>;
  runTidy: () => Promise<void>;
}

export function useOperations(): OperationsView {
  const { client, status: connection } = useHomeClient();
  const ready = client && connection.kind === "connected" ? client : null;
  const visible = usePageActive("operations");

  const statusLoad = useMemo(() => (ready ? () => ready.memoryStatus(ACTIVE_CHARACTER_ID) : null), [ready]);
  const usageLoad = useMemo(() => (ready ? () => ready.mediaUsage() : null), [ready]);
  const status = useCachedFetch("memory-status", statusLoad, { schema: MemoryStatusResultSchema, persist: true, enabled: visible });
  const usage = useCachedFetch("media-usage", usageLoad, { schema: MediaUsageResultSchema, persist: true, enabled: visible });

  const refreshStatus = status.refresh;
  const refreshUsage = usage.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshUsage()]);
  }, [refreshStatus, refreshUsage]);

  const invalidateStatus = status.invalidate;
  const invalidateUsage = usage.invalidate;
  const afterTidy = useCallback(async () => {
    await Promise.all([invalidateStatus(), invalidateUsage()]);
  }, [invalidateStatus, invalidateUsage]);
  const tidy = useMemoryTidy(ready, afterTidy);

  // The purge accepts only the authenticated client. Its immediate ref guard starts one destructive request, while
  // a close/deadline rejection releases the phase and leaves an explicit retry to the operator.
  const clear = useMediaClear(ready, () => void usage.invalidate());

  return {
    status: status.data,
    usage: usage.data,
    statusLoading: status.loading, usageLoading: usage.loading,
    statusError: status.error, usageError: usage.error,
    refreshStatus, refreshUsage,
    connectionReady: ready !== null,
    ...tidy,
    refreshing: status.refreshing || usage.refreshing,
    clear,
    refresh,
  };
}
