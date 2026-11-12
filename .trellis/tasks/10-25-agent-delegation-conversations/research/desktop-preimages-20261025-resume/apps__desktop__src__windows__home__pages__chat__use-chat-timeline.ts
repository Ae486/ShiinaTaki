/**
 * INPUT:  Chat's current restored client and canonical/live store selectors
 * OUTPUT: ordered date-grouped display items, legacy fallback, guarded send/cancel and history actions
 * POS:    ui/chat — view-model hook; the connection restorer and focused action hooks own their asynchronous work
 */

import { useMemo } from "react";
import type { ImageAttachment } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { useChatTimelineStore, type InflightRow } from "./chat-timeline-store.ts";
import { groupByLocalDate, type DateGroup } from "./date-group.ts";
import { projectChatTranscript, type ChatTranscriptItem } from "./chat-transcript.ts";
import { useChatSend } from "./use-chat-send.ts";
import { useChatHistory } from "./use-chat-history.ts";

export interface ChatTimeline {
  groups: DateGroup<ChatTranscriptItem>[];
  items: ChatTranscriptItem[];
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
  historyError: string | null;
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
  const turns = useChatTimelineStore((s) => s.live.turns);
  const inflight = useChatTimelineStore((s) => s.inflight);
  const loaded = useChatTimelineStore((s) => s.loaded);
  const nextBefore = useChatTimelineStore((s) => s.nextBefore);
  const truncated = useChatTimelineStore((s) => s.truncated);
  const sending = useChatSend(client);
  const history = useChatHistory(client);

  const items = useMemo(() => projectChatTranscript(entries, turns), [entries, turns]);
  const groups = useMemo(() => groupByLocalDate(items), [items]);
  return {
    groups, items, inflight, loaded, hasMore: nextBefore !== null, truncated, ...sending, ...history,
  };
}
