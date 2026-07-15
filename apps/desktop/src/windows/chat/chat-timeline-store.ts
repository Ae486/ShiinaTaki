/**
 * INPUT:  history pages (timeline.history), live timeline.appended pushes, and chat.delta/complete/error from the hook.
 * OUTPUT: the chat window's timeline state (entries by seq + the in-flight assistant row + inline notices) + reducers.
 * POS:    ui/windows/chat (feature-local store) — the depth-view conversation domain. One continuous timeline, NO
 *         session list. The hook wires the WS to these reducers; components read via the hook (hook-guidelines).
 */

import { create } from "zustand";
import type { TimelineEntry, TimelineHistoryResult } from "@taki/shared";

// The in-flight assistant row: streamed text not yet persisted as a timeline entry. Keyed by the turn's messageId
// (chat.delta/complete carry it). Dropped the moment the persisted assistant entry arrives via timeline.appended
// (or, as a safety net, on chat.complete) — one visual stream, no duplicate flash (#17).
export interface InflightRow {
  messageId: string;
  text: string;
}

// An inline system notice (a chat.error such as "images require a vision model", or a provider failure). Rendered
// in-stream at the bottom; the composer's attach button stays enabled — v1 has no vision-config discovery (decision 5).
export interface TimelineNotice {
  id: string;
  message: string;
}

type ChatTimelineStore = {
  entries: TimelineEntry[]; // ascending by seq (oldest -> newest)
  nextBefore: number | null; // cursor for the next OLDER page; null = start of history reached
  loaded: boolean; // the first history page has settled
  inflight: InflightRow | null;
  notices: TimelineNotice[];
  /** Initial newest-first page: reversed to chronological, merged with any live rows that raced in. */
  mergeHistory: (page: TimelineHistoryResult) => void;
  /** An older page (scroll-to-top): merged in; the cursor moves further back. */
  prependOlder: (page: TimelineHistoryResult) => void;
  /** A committed row (user/assistant/tool). An assistant row hands off the in-flight row (drops it). */
  appendLive: (entry: TimelineEntry) => void;
  growInflight: (messageId: string, delta: string) => void;
  clearInflight: () => void;
  pushNotice: (message: string) => void;
  reset: () => void;
};

// Dedup by seq (a live row can also arrive in a history page) and keep ascending — the single ordering invariant.
function mergeBySeq(existing: TimelineEntry[], incoming: TimelineEntry[]): TimelineEntry[] {
  const bySeq = new Map<number, TimelineEntry>();
  for (const entry of [...existing, ...incoming]) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

let noticeSeq = 0;

export const useChatTimelineStore = create<ChatTimelineStore>()((set) => ({
  entries: [],
  nextBefore: null,
  loaded: false,
  inflight: null,
  notices: [],
  mergeHistory: (page) =>
    set((state) => ({ entries: mergeBySeq(state.entries, page.entries), nextBefore: page.nextBefore, loaded: true })),
  prependOlder: (page) =>
    set((state) => ({ entries: mergeBySeq(state.entries, page.entries), nextBefore: page.nextBefore })),
  appendLive: (entry) =>
    set((state) => ({
      entries: mergeBySeq(state.entries, [entry]),
      inflight: entry.role === "assistant" ? null : state.inflight,
    })),
  growInflight: (messageId, delta) =>
    set((state) => ({
      inflight:
        state.inflight?.messageId === messageId
          ? { messageId, text: state.inflight.text + delta }
          : { messageId, text: delta },
    })),
  clearInflight: () => set({ inflight: null }),
  pushNotice: (message) =>
    set((state) => ({ notices: [...state.notices, { id: `n${++noticeSeq}`, message }], inflight: null })),
  reset: () => set({ entries: [], nextBefore: null, loaded: false, inflight: null, notices: [] }),
}));
