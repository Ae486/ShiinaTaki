/**
 * INPUT:  the current Chat client plus explicit older-page and widened-window requests
 * OUTPUT: serialized generation-safe paging, preserved cursors and visible retryable read errors
 * POS:    ui/chat — disposable history hook; retired responses never mutate the replacement view
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TIMELINE_HISTORY_LIMIT_DEFAULT, TIMELINE_HISTORY_LIMIT_MAX } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore } from "./chat-timeline-store.ts";

const TIMELINE_RESTORE_MAX_PAGES = 3; // Existing P1b click budget: one enlarged mounted window per explicit request.

async function restoreWindow(client: WsClient, isCurrent: () => boolean): Promise<void> {
  let filled = false;
  useChatTimelineStore.getState().widenWindow();
  for (let index = 0; index < TIMELINE_RESTORE_MAX_PAGES && isCurrent(); index += 1) {
    const before = useChatTimelineStore.getState().nextBefore;
    if (before === null) { filled = true; break; }
    const page = await client.timelineHistory({ characterId: ACTIVE_CHARACTER_ID, before, limit: TIMELINE_HISTORY_LIMIT_MAX });
    if (!isCurrent()) return;
    useChatTimelineStore.getState().prependOlder(page);
    const state = useChatTimelineStore.getState();
    if (page.entries.length === 0 || state.entries.length >= state.windowLimit) {
      filled = state.nextBefore === null || state.entries.length >= state.windowLimit;
      break;
    }
  }
  if (isCurrent()) useChatTimelineStore.getState().settleRestore(filled);
}

async function readOlder(client: WsClient, isCurrent: () => boolean): Promise<void> {
  const before = useChatTimelineStore.getState().nextBefore;
  if (before === null) return;
  const page = await client.timelineHistory({ characterId: ACTIVE_CHARACTER_ID, before, limit: TIMELINE_HISTORY_LIMIT_DEFAULT });
  if (isCurrent()) useChatTimelineStore.getState().prependOlder(page);
}

export function useChatHistory(client: WsClient | null) {
  const clientRef = useRef(client);
  clientRef.current = client;
  const request = useRef<object | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [historyError, setError] = useState<string | null>(null);
  useEffect(() => {
    request.current = null; setRestoring(false); setError(null);
    return () => { request.current = null; };
  }, [client]);
  const load = useCallback((widen: boolean) => {
    if (!client || request.current || useChatTimelineStore.getState().nextBefore === null) return;
    const ticket = {};
    request.current = ticket;
    const current = () => request.current === ticket && clientRef.current === client;
    setError(null); setRestoring(widen);
    void (widen ? restoreWindow(client, current) : readOlder(client, current)).catch(() => {
      if (!current()) return;
      useChatTimelineStore.getState().settleRestore(false);
      setError("暂时无法加载更早的聊天记录，请重试。");
    }).finally(() => { if (current()) { request.current = null; setRestoring(false); } });
  }, [client]);
  const loadOlder = useCallback(() => load(false), [load]);
  const restoreOlder = useCallback(() => load(true), [load]);
  return { loadOlder, restoreOlder, restoring, historyError };
}
