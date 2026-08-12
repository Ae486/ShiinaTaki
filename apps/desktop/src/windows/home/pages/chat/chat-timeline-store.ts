/**
 * INPUT:  history pages (timeline.history), live timeline.appended/removed pushes, and chat.delta/complete from the hook.
 * OUTPUT: the chat page's timeline state (entries by seq + the in-flight assistant row) + reducers. Transient
 *         notices moved to components/toast (D34) — errors clearInflight here and pushToast there.
 * POS:    ui/windows/home/pages/chat (page-local store) — the depth-view conversation domain. One continuous timeline, NO
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

type ChatTimelineStore = {
  entries: TimelineEntry[]; // ascending by seq (oldest -> newest)
  nextBefore: number | null; // cursor for the next OLDER page; null = start of history reached
  loaded: boolean; // the first history page has settled
  inflight: InflightRow | null;
  /** Initial newest-first page: reversed to chronological, merged with any live rows that raced in. */
  mergeHistory: (page: TimelineHistoryResult) => void;
  /** Reconnect newest page: replace its covered pre-restore cache while preserving older pages and raced live rows. */
  reconcileLatest: (input: TimelineReconciliation) => void;
  /** An older page (scroll-to-top): merged in; the cursor moves further back. */
  prependOlder: (page: TimelineHistoryResult) => void;
  /** A committed row (user/assistant/tool). An assistant row hands off the in-flight row (drops it). */
  appendLive: (entry: TimelineEntry) => void;
  /** A retracted row (cancel-before-reply): drop the entry with this seq from the live timeline. */
  removeEntry: (seq: number) => void;
  growInflight: (messageId: string, delta: string) => void;
  clearInflight: () => void;
  reset: () => void;
};

export interface TimelineRestoreBaseline {
  seqs: ReadonlySet<number>;
  nextBefore: number | null;
  loaded: boolean;
}

export interface TimelineReconciliation {
  page: TimelineHistoryResult;
  baseline: TimelineRestoreBaseline;
  removedDuringRestore: ReadonlySet<number>;
}

// Dedup by seq (a live row can also arrive in a history page) and keep ascending — the single ordering invariant.
function mergeBySeq(existing: TimelineEntry[], incoming: TimelineEntry[]): TimelineEntry[] {
  const bySeq = new Map<number, TimelineEntry>();
  for (const entry of [...existing, ...incoming]) bySeq.set(entry.seq, entry);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function reconcileLatestEntries(state: ChatTimelineStore, input: TimelineReconciliation): TimelineEntry[] {
  const { page, baseline, removedDuringRestore } = input;
  const pageSeqs = new Set(page.entries.map((entry) => entry.seq));
  const coverageFloor = page.entries.at(-1)?.seq ?? null;
  const retained = state.entries.filter((entry) => {
    if (removedDuringRestore.has(entry.seq)) return false;
    if (!baseline.seqs.has(entry.seq)) return true;
    if (pageSeqs.has(entry.seq)) return false;
    if (page.nextBefore === null) return false;
    return coverageFloor !== null && entry.seq < coverageFloor;
  });
  const incoming = page.entries.filter((entry) => !removedDuringRestore.has(entry.seq));
  return mergeBySeq(retained, incoming);
}

export const useChatTimelineStore = create<ChatTimelineStore>()((set) => ({
  entries: [],
  nextBefore: null,
  loaded: false,
  inflight: null,
  mergeHistory: (page) =>
    set((state) => ({ entries: mergeBySeq(state.entries, page.entries), nextBefore: page.nextBefore, loaded: true })),
  reconcileLatest: (input) =>
    set((state) => ({
      entries: reconcileLatestEntries(state, input),
      nextBefore: input.baseline.loaded ? input.baseline.nextBefore : input.page.nextBefore,
      loaded: true,
    })),
  prependOlder: (page) =>
    set((state) => ({ entries: mergeBySeq(state.entries, page.entries), nextBefore: page.nextBefore })),
  appendLive: (entry) =>
    set((state) => ({
      entries: mergeBySeq(state.entries, [entry]),
      inflight: entry.role === "assistant" ? null : state.inflight,
    })),
  removeEntry: (seq) => set((state) => ({ entries: state.entries.filter((entry) => entry.seq !== seq) })),
  growInflight: (messageId, delta) =>
    set((state) => ({
      inflight:
        state.inflight?.messageId === messageId
          ? { messageId, text: state.inflight.text + delta }
          : { messageId, text: delta },
    })),
  clearInflight: () => set({ inflight: null }),
  reset: () => set({ entries: [], nextBefore: null, loaded: false, inflight: null }),
}));
