/**
 * INPUT:  the home shell's WsClient (memory.tidy / memory.status / media.usage) + ACTIVE_CHARACTER_ID.
 * OUTPUT: useOperations() -> status/usage snapshots, the tidy trigger and the attachment-purge control.
 * POS:    ui/windows/home/pages/operations — the page's ws touchpoint (hook-guidelines). Glue only: the view models
 *         live in operations-state.ts and the destructive purge in use-media-clear.ts.
 */

import { useCallback, useEffect, useState } from "react";
import type { MediaUsageResult, MemoryStatusResult, MemoryTidyResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { useHomeClient } from "../../home-client-context.ts";
import { useMediaClear, type MediaClearControl } from "./use-media-clear.ts";

export interface OperationsView {
  status: MemoryStatusResult | null;
  usage: MediaUsageResult | null;
  tidy: MemoryTidyResult | null;
  tidying: boolean;
  clear: MediaClearControl;
  error: string | null;
  runTidy: () => Promise<void>;
}

export function useOperations(): OperationsView {
  const { client, status: connection } = useHomeClient();
  const connected = connection.kind === "connected";
  const [status, setStatus] = useState<MemoryStatusResult | null>(null);
  const [usage, setUsage] = useState<MediaUsageResult | null>(null);
  const [tidy, setTidy] = useState<MemoryTidyResult | null>(null);
  const [tidying, setTidying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const [nextStatus, nextUsage] = await Promise.all([client.memoryStatus(ACTIVE_CHARACTER_ID), client.mediaUsage()]);
      setStatus(nextStatus);
      setUsage(nextUsage);
    } catch (cause) {
      fail(cause);
    }
  }, [client, fail]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const runTidy = useCallback(async () => {
    if (!client || tidying) return;
    setTidying(true);
    setError(null);
    try {
      setTidy(await client.memoryTidy(ACTIVE_CHARACTER_ID));
      await refresh(); // the pass moves the tidy watermark — re-read rather than guess
    } catch (cause) {
      fail(cause);
    } finally {
      setTidying(false);
    }
  }, [client, tidying, refresh, fail]);

  const clear = useMediaClear(client, () => void refresh());

  return { status, usage, tidy, tidying, clear, error, runTidy };
}
