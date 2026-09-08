/**
 * INPUT:  the home shell's WsClient + a refresh callback to run once the purge settles.
 * OUTPUT: useMediaClear(client, onSettled) -> { phase, notice, error, onEvent } — the two-step attachment purge.
 * POS:    ui/windows/home/pages/operations — the destructive action, split out of use-operations so the guard (a purge
 *         is issued ONLY from the confirming step) sits alone with the call it protects.
 */

import { useCallback, useRef, useState } from "react";
import type { WsClient } from "@/lib/ws-client.js";
import { clearPhaseAfter, type ClearEvent, type ClearPhase } from "./operations-state.ts";

export interface MediaClearControl {
  phase: ClearPhase;
  notice: string | null;
  error: string | null;
  onEvent: (event: ClearEvent) => void;
}

export function useMediaClear(client: WsClient | null, onSettled: () => void): MediaClearControl {
  const [phase, setPhase] = useState<ClearPhase>("idle");
  const phaseRef = useRef<ClearPhase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentClient = useRef(client);
  currentClient.current = client;

  const onEvent = useCallback(
    (event: ClearEvent) => {
      const current = phaseRef.current;
      const next = clearPhaseAfter(current, event);
      if (next === current) return;
      if (next !== "clearing") {
        phaseRef.current = next;
        setPhase(next);
        return;
      }
      if (!client) return;
      phaseRef.current = next;
      setPhase(next);
      setError(null);
      void client
        .mediaClear()
        .then((result) => {
          if (currentClient.current !== client) return;
          setNotice(`已清除 ${result.removedCount} 个附件，释放 ${result.freedBytes} 字节`);
          onSettled();
        })
        .catch((cause: unknown) => {
          if (currentClient.current === client) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          phaseRef.current = "idle";
          setPhase("idle");
        });
    },
    [client, onSettled],
  );

  return { phase, notice, error, onEvent };
}
