/**
 * INPUT:  the home shell's WsClient (perception.card / perception.pauseGet / perception.pauseSet).
 * OUTPUT: usePerception() -> { card, pause, error, refreshing, setPause, refresh } — the perception page's data seam.
 * POS:    ui/windows/home/pages/perception — the ONLY ws touchpoint of the page (hook-guidelines). Every write echoes
 *         the resulting server state; nothing is optimistically assumed (a lapsed deadline self-resumes core-side).
 *         The card is cached in MEMORY ONLY (its activity rows are foreground-window titles) and the pause state is not
 *         cached at all: a stale "not paused" is a privacy claim this page must never make. P1e: reads are SKIPPED while the
 *         page is hidden and rerun on reactivation (page-visibility-store).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PerceptionCardSchema, type PerceptionCard, type PerceptionPauseSetParams, type PerceptionPauseState } from "@taki/shared";
import { useCachedFetch } from "@/lib/use-cached-fetch.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";

export interface PerceptionView {
  card: PerceptionCard | null;
  pause: PerceptionPauseState | null;
  connectionReady: boolean;
  error: string | null;
  /** A background re-read of the card is running over the one on screen. */
  refreshing: boolean;
  setPause: (params: PerceptionPauseSetParams) => Promise<void>;
  refresh: () => Promise<void>;
}

export async function readPauseReplacement(
  client: Pick<WsClient, "perceptionPauseGet">,
  apply: (pause: PerceptionPauseState) => void,
  clearError: () => void,
): Promise<void> {
  const replacement = await client.perceptionPauseGet();
  apply(replacement);
  clearError();
}

export function usePerception(): PerceptionView {
  const { client, status } = useHomeClient();
  const ready = client && status.kind === "connected" ? client : null;
  // P1e: a hidden page does no Core reads — card and pause reads key on visibility too and rerun on reactivation.
  const visible = usePageVisible("perception");
  const [pause, setPauseState] = useState<PerceptionPauseState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);

  const cardLoad = useMemo(() => (ready && visible ? () => ready.perceptionCard() : null), [ready, visible]);
  const card = useCachedFetch("perception-card", cardLoad, { schema: PerceptionCardSchema });
  const refreshCard = card.refresh;

  const refreshPause = useCallback(async () => {
    if (!ready || !visible) return;
    try {
      await readPauseReplacement(ready, setPauseState, () => setError(null));
    } catch (cause) {
      fail(cause);
    }
  }, [ready, visible, fail]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshCard(), refreshPause()]);
  }, [refreshCard, refreshPause]);

  useEffect(() => {
    void refreshPause();
  }, [refreshPause]);

  const setPause = useCallback(
    async (params: PerceptionPauseSetParams) => {
      if (!ready) return;
      setError(null);
      try {
        setPauseState(await ready.perceptionPauseSet(params));
        await refreshCard(); // the card's samplingStatus follows the pause — re-read rather than infer it
      } catch (cause) {
        fail(cause);
      }
    },
    [ready, refreshCard, fail],
  );

  return {
    card: card.data,
    pause,
    connectionReady: ready !== null,
    error: error ?? card.error,
    refreshing: card.refreshing,
    setPause,
    refresh,
  };
}
