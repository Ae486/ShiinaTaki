/**
 * INPUT:  the chat page's currently connected/restored WsClient; live chat.* events and the restored timeline store.
 * OUTPUT: useChatTimeline(client, ready) -> ChatTimeline: date-grouped rows + in-flight row + send/cancel/loadOlder/
 *         restoreOlder + retractedDraft/consumeRetractedDraft (cancel-before-reply hand-back). Errors toast via
 *         components/toast (D34); streamed deltas ride the coalescer (P1a).
 * POS:    ui/windows/home/pages/chat — the ONLY touchpoint between the page and ws-client/store (hook-guidelines). Wires the WS
 *         to the timeline store: initial history page, live appends + removals, streamed deltas, older-page paging.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  TIMELINE_HISTORY_LIMIT_DEFAULT, TIMELINE_HISTORY_LIMIT_MAX, type ImageAttachment,
} from "@taki/shared";
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import { pushToast } from "@/components/toast/toast-store.js";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore, type InflightRow } from "./chat-timeline-store.ts";
import { recordDelta } from "./chat-delta-coalescer.ts";
import { groupByLocalDate, type DateGroup } from "./date-group.ts";

// One send: deltas grow the in-flight row through the coalescer (keyed by messageId); complete drops it (the
// persisted entry already arrived via timeline.appended); a plain error drops the in-flight row and surfaces as a
// toast (D34). A cancel-before-reply is NOT an error — the message was retracted, so its text is handed back via
// onRetracted (restore/toast, never a red error). Attachments ride only when present (text-only sends stay byte-identical).
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
    onDelta: (delta, messageId) => recordDelta(messageId, delta),
    onComplete: () => useChatTimelineStore.getState().clearInflight(),
    onError: (_code, reason, retracted) => {
      useChatTimelineStore.getState().clearInflight();
      if (retracted) onRetracted(message);
      else pushToast(reason);
    },
  });
}

// One restore click mounts one more window-step of history (P1b): pages of the shared max size until the widened
// window fills or history exhausts. Bounded so a misbehaving cursor cannot loop.
const TIMELINE_RESTORE_MAX_PAGES = 3;

/** P1b jump-restore: widen the mounted window FIRST so restored pages are not re-trimmed, page back until it fills
 *  (or history exhausts), then settle the jump-control flag — false keeps it up for a retry after a failed page. */
function startRestore(client: WsClient, onSettled: () => void): void {
  void (async () => {
    let filled = false;
    useChatTimelineStore.getState().widenWindow();
    for (let page = 0; page < TIMELINE_RESTORE_MAX_PAGES; page += 1) {
      const before = useChatTimelineStore.getState().nextBefore;
      if (before === null) { filled = true; break; }
      const result = await client.timelineHistory({ characterId: ACTIVE_CHARACTER_ID, before, limit: TIMELINE_HISTORY_LIMIT_MAX });
      useChatTimelineStore.getState().prependOlder(result);
      const state = useChatTimelineStore.getState();
      if (result.entries.length === 0 || state.entries.length >= state.windowLimit) {
        filled = state.nextBefore === null || state.entries.length >= state.windowLimit;
        break;
      }
    }
    useChatTimelineStore.getState().settleRestore(filled);
  })()
    .catch(() => useChatTimelineStore.getState().settleRestore(false))
    .finally(onSettled);
}

export interface ChatTimeline {
  groups: DateGroup[];
  inflight: InflightRow | null;
  loaded: boolean;
  hasMore: boolean;
  /** P1b: older rows were trimmed off the mounted window — the "加载更早消息" jump control is up. */
  truncated: boolean;
  isSending: boolean;
  loadOlder: () => void;
  /** P1b jump-restore: widen the mounted window, then refetch older pages until it fills (or history exhausts). */
  restoreOlder: () => void;
  restoring: boolean;
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
  const truncated = useChatTimelineStore((s) => s.truncated);
  const [isSending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(false);
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

  // P1b jump-restore: shared guard with loadOlder so a jump and a top-reach auto-load never race.
  const restoreOlder = useCallback(() => {
    if (!client || loadingOlder.current) return;
    loadingOlder.current = true;
    setRestoring(true);
    startRestore(client, () => {
      loadingOlder.current = false;
      setRestoring(false);
    });
  }, [client]);

  const groups = useMemo(() => groupByLocalDate(entries), [entries]);
  const consumeRetractedDraft = useCallback(() => setRetractedDraft(null), []);
  return {
    groups, inflight, loaded, hasMore: nextBefore !== null, truncated, isSending, loadOlder,
    restoreOlder, restoring, send, cancel, retractedDraft, consumeRetractedDraft,
  };
}
