/**
 * INPUT:  the home shell's WsClient (perception.card / perception.pauseGet / perception.pauseSet).
 * OUTPUT: usePerception() -> { card, pause, error, setPause, refresh } — the perception page's data seam.
 * POS:    ui/windows/home/pages/perception — the ONLY ws touchpoint of the page (hook-guidelines). Every write echoes
 *         the resulting server state; nothing is optimistically assumed (a lapsed deadline self-resumes core-side).
 */

import { useCallback, useEffect, useState } from "react";
import type { PerceptionCard, PerceptionPauseSetParams, PerceptionPauseState } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";

export interface PerceptionView {
  card: PerceptionCard | null;
  pause: PerceptionPauseState | null;
  error: string | null;
  setPause: (params: PerceptionPauseSetParams) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePerception(): PerceptionView {
  const { client, status } = useHomeClient();
  const connected = status.kind === "connected";
  const [card, setCard] = useState<PerceptionCard | null>(null);
  const [pause, setPauseState] = useState<PerceptionPauseState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const [nextCard, nextPause] = await Promise.all([client.perceptionCard(), client.perceptionPauseGet()]);
      setCard(nextCard);
      setPauseState(nextPause);
    } catch (cause) {
      fail(cause);
    }
  }, [client, fail]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const setPause = useCallback(
    async (params: PerceptionPauseSetParams) => {
      if (!client) return;
      setError(null);
      try {
        setPauseState(await client.perceptionPauseSet(params));
        await refresh(); // the card's samplingStatus follows the pause — re-read rather than infer it
      } catch (cause) {
        fail(cause);
      }
    },
    [client, refresh, fail],
  );

  return { card, pause, error, setPause, refresh };
}
