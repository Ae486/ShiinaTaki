/**
 * INPUT:  current Home client and invalidation for the memory/storage projections affected by tidy.
 * OUTPUT: one explicit tidy attempt, captured result/error and a lock that survives page hiding.
 * POS:    Home Operations — mutation lifetime only; no timeout/reconnect replay or hidden read work.
 */
import { useCallback, useRef, useState } from "react";
import type { MemoryTidyResult } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { WsClient } from "@/lib/ws-client.js";

export function useMemoryTidy(client: WsClient | null, onSettled: () => Promise<void>) {
  const currentClient = useRef(client);
  currentClient.current = client;
  const lock = useRef(false);
  const [tidy, setTidy] = useState<MemoryTidyResult | null>(null);
  const [tidying, setTidying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runTidy = useCallback(async () => {
    if (!client || lock.current) return;
    lock.current = true;
    setTidying(true);
    setError(null);
    try {
      const result = await client.memoryTidy(ACTIVE_CHARACTER_ID);
      if (currentClient.current !== client) return;
      setTidy(result);
      await onSettled();
    } catch (cause) {
      if (currentClient.current === client) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      lock.current = false;
      setTidying(false);
    }
  }, [client, onSettled]);
  return { tidy, tidying, error, runTidy };
}
