/**
 * INPUT:  the chat page's currently connected/restored WsClient; live chat.* events and the restored timeline store.
 * OUTPUT: useChatTimeline(client, ready) -> ChatTimeline: date-grouped rows + in-flight row + send/cancel/loadOlder +
 *         retractedDraft/consumeRetractedDraft (cancel-before-reply hand-back). Errors toast via components/toast (D34).
 * POS:    ui/windows/home/pages/chat — the ONLY touchpoint between the page and ws-client/store (hook-guidelines). Wires the WS
 *         to the timeline store: initial history page, live appends + removals, streamed deltas, older-page paging.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { TIMELINE_HISTORY_LIMIT_DEFAULT, type ImageAttachment } from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { pushToast } from "@/components/toast/toast-store.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore, type InflightRow } from "./chat-timeline-store.ts";
import { groupByLocalDate, type DateGroup } from "./date-group.ts";

// One send: deltas grow the in-flight row (keyed by messageId); complete drops it (the persisted entry already
// arrived via timeline.appended); a plain error drops the in-flight row and surfaces as a toast (D34). A
// cancel-before-reply is NOT an error — the message was retracted, so its text is handed back via onRetracted
// (restore/toast, never a red error). Attachments ride only when present (text-only sends stay byte-identical).
function runSend(
  client: WsClient,
  input: { message: string; attachments: ImageAttachment[] },
  onRetracted: (message: string) => void,
): Promise<void> {
  const { message, attachments } = input;
  const params =
    attachments.length > 0
      ? { characterId: ACTIVE_CHARACTER_ID, message, attachments }
      : { characterId: ACTIVE_CHARACTER_ID, message };
  return client.chat(params, {
    onDelta: (delta, messageId) => useChatTimelineStore.getState().growInflight(messageId, delta),
    onComplete: () => useChatTimelineStore.getState().clearInflight(),
    onError: (_code, reason, retracted) => {
      useChatTimelineStore.getState().clearInflight();
      if (retracted) onRetracted(message);
      else pushToast(reason);
    },
  });
}

export interface ChatTimeline {
  groups: DateGroup[];
  inflight: InflightRow | null;
  loaded: boolean;
  hasMore: boolean;
  isSending: boolean;
  loadOlder: () => void;
  send: (message: string, attachments: ImageAttachment[]) => void;
  /** Aborts the in-flight turn (the composer's 中断 button); isSending releases when the cancelled turn settles. */
  cancel: () => void;
  /** The text of a message retracted by a cancel-before-reply, for the composer to restore; null when none pending. */
  retractedDraft: string | null;
  /** Clears the pending retracted draft once the composer has consumed it (restored or toasted). */
  consumeRetractedDraft: () => void;
}

export function useChatTimeline(client: WsClient | null): ChatTimeline {
  const entries = useChatTimelineStore((s) => s.entries);
  const inflight = useChatTimelineStore((s) => s.inflight);
  const loaded = useChatTimelineStore((s) => s.loaded);
  const nextBefore = useChatTimelineStore((s) => s.nextBefore);
  const [isSending, setSending] = useState(false);
  // A cancel-before-reply hands the retracted text back here; the composer restores it (or toasts it) then consumes.
  const [retractedDraft, setRetractedDraft] = useState<string | null>(null);
  const loadingOlder = useRef(false);

  const send = useCallback(
    (message: string, attachments: ImageAttachment[]) => {
      if (!client) return;
      setSending(true);
      void runSend(client, { message, attachments }, setRetractedDraft)
        .catch((error: unknown) => pushToast(String(error)))
        .finally(() => setSending(false));
    },
    [client],
  );

  // Fire-and-forget: the server aborts the turn and the pending chat() settles via chat.complete/error, which is
  // what releases isSending — no local state to unwind here. cancelled:false (nothing running) is a harmless no-op.
  const cancel = useCallback(() => {
    if (client) void client.chatCancel(ACTIVE_CHARACTER_ID).catch(() => undefined);
  }, [client]);

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
  const consumeRetractedDraft = useCallback(() => setRetractedDraft(null), []);
  return { groups, inflight, loaded, hasMore: nextBefore !== null, isSending, loadOlder, send, cancel, retractedDraft, consumeRetractedDraft };
}
