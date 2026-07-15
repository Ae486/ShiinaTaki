/**
 * INPUT:  the chat window's WsClient + a `ready` (authenticated) flag; live chat.* + timeline.appended events.
 * OUTPUT: useChatTimeline(client, ready) -> ChatTimeline: date-grouped rows + in-flight row + notices + send/loadOlder.
 * POS:    ui/windows/chat — the ONLY touchpoint between the window and ws-client/store (hook-guidelines). Wires the WS
 *         to the timeline store: initial history page, live appends, streamed deltas, older-page paging.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TIMELINE_HISTORY_LIMIT_DEFAULT, type ImageAttachment } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore, type InflightRow, type TimelineNotice } from "./chat-timeline-store.ts";
import { groupByLocalDate, type DateGroup } from "./date-group.ts";

// Subscribe FIRST (live appends buffer into the store via the registered handler), then load the newest page and
// merge — an entry that races in between is deduped by seq, never lost or double-shown.
async function subscribeAndLoad(client: WsClient): Promise<void> {
  await client.subscribeTimeline(ACTIVE_CHARACTER_ID);
  const page = await client.timelineHistory({ characterId: ACTIVE_CHARACTER_ID, limit: TIMELINE_HISTORY_LIMIT_DEFAULT });
  useChatTimelineStore.getState().mergeHistory(page);
}

// One send: deltas grow the in-flight row (keyed by messageId); complete drops it (the persisted entry already
// arrived via timeline.appended); error becomes an inline notice. Attachments ride only when present (text-only
// sends stay byte-identical to the bubble's).
function runSend(client: WsClient, message: string, attachments: ImageAttachment[]): Promise<void> {
  const params =
    attachments.length > 0
      ? { characterId: ACTIVE_CHARACTER_ID, message, attachments }
      : { characterId: ACTIVE_CHARACTER_ID, message };
  return client.chat(params, {
    onDelta: (delta, messageId) => useChatTimelineStore.getState().growInflight(messageId, delta),
    onComplete: () => useChatTimelineStore.getState().clearInflight(),
    onError: (_code, reason) => useChatTimelineStore.getState().pushNotice(reason),
  });
}

export interface ChatTimeline {
  groups: DateGroup[];
  inflight: InflightRow | null;
  notices: TimelineNotice[];
  loaded: boolean;
  hasMore: boolean;
  isSending: boolean;
  loadOlder: () => void;
  send: (message: string, attachments: ImageAttachment[]) => void;
}

export function useChatTimeline(client: WsClient | null, ready: boolean): ChatTimeline {
  const entries = useChatTimelineStore((s) => s.entries);
  const inflight = useChatTimelineStore((s) => s.inflight);
  const notices = useChatTimelineStore((s) => s.notices);
  const loaded = useChatTimelineStore((s) => s.loaded);
  const nextBefore = useChatTimelineStore((s) => s.nextBefore);
  const [isSending, setSending] = useState(false);
  const loadingOlder = useRef(false);

  useEffect(() => {
    if (!client || !ready) return;
    useChatTimelineStore.getState().reset();
    client.onTimelineAppended((entry) => useChatTimelineStore.getState().appendLive(entry));
    let cancelled = false;
    void subscribeAndLoad(client).catch((error: unknown) => {
      if (!cancelled) useChatTimelineStore.getState().pushNotice(`加载历史失败：${String(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [client, ready]);

  const send = useCallback(
    (message: string, attachments: ImageAttachment[]) => {
      if (!client) return;
      setSending(true);
      void runSend(client, message, attachments)
        .catch((error: unknown) => useChatTimelineStore.getState().pushNotice(String(error)))
        .finally(() => setSending(false));
    },
    [client],
  );

  const loadOlder = useCallback(() => {
    const before = useChatTimelineStore.getState().nextBefore;
    if (!client || before === null || loadingOlder.current) return;
    loadingOlder.current = true;
    void client
      .timelineHistory({ characterId: ACTIVE_CHARACTER_ID, before, limit: TIMELINE_HISTORY_LIMIT_DEFAULT })
      .then((page) => useChatTimelineStore.getState().prependOlder(page))
      .catch(() => undefined)
      .finally(() => (loadingOlder.current = false));
  }, [client]);

  const groups = useMemo(() => groupByLocalDate(entries), [entries]);
  return { groups, inflight, notices, loaded, hasMore: nextBefore !== null, isSending, loadOlder, send };
}
