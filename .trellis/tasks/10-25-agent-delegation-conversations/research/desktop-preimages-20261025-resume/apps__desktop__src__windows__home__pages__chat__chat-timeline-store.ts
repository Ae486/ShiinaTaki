/**
 * INPUT:  canonical history/append/commit notifications, shared activity views and the legacy delta fallback
 * OUTPUT: bounded canonical rows plus atomic live handoffs, history coverage and disposable recovery state
 * POS:    ui/chat — one continuous Timeline view; Core remains the only persistence and execution authority
 */

import { create, type StoreApi } from "zustand";
import type { TimelineCommitted, TimelineEntry, TimelineHistoryResult } from "@taki/shared";
import type { ChatActivityView } from "@/lib/chat-activity-state.js";
import {
  applyTimelineActivity, commitTimelineActivity, emptyTimelineActivity, reconcileActivityHistory,
  stageTimelineEntry, staleTimelineActivity, type TimelineActivityState,
} from "./chat-timeline-activity.ts";
import { mergeTimelineEntries } from "./timeline-batch.ts";

// P1b: bounded mounted window. The entries array keeps the NEWEST windowLimit rows; when an insert pushes past the
// limit the OLDEST rows slide out (they stay Core-readable — the trim re-points nextBefore at the new window edge)
// and `truncated` raises the "加载更早消息" jump control, whose restore widens the window before refetching.
export const TIMELINE_MOUNT_CAP = 300;
// One restore click mounts one more window-step of history (~2 pages at the shared 200-row page max).
export const TIMELINE_RESTORE_STEP = 300;

// The legacy in-flight assistant row: streamed text not yet persisted as a timeline entry. Keyed by the turn's messageId
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
  live: TimelineActivityState;
  windowLimit: number; // P1b: mounted-row window; raised by widenWindow, never shrinks
  truncated: boolean; // P1b: oldest rows were trimmed off — the jump control is up
  /** Initial newest-first page: reversed to chronological, merged with any live rows that raced in. */
  mergeHistory: (page: TimelineHistoryResult) => void;
  /** Reconnect newest page: replace its covered pre-restore cache while preserving older pages and raced live rows. */
  reconcileLatest: (input: TimelineReconciliation) => void;
  /** An older page (scroll-to-top or jump-restore): merged in; the cursor moves further back. */
  prependOlder: (page: TimelineHistoryResult) => void;
  /** Legacy rows append immediately; modern batch rows remain staged until complete handoff. */
  appendLive: (entry: TimelineEntry) => void;
  applyActivity: (view: ChatActivityView) => void;
  commitBatch: (batch: TimelineCommitted) => void;
  markActivityStale: () => void;
  /** A retracted row (cancel-before-reply): drop the entry with this seq from the live timeline. */
  removeEntry: (seq: number) => void;
  growInflight: (messageId: string, delta: string) => void;
  /** Coalesced-flush append (P1a): grows the row ONLY while the row the stream created still exists — after a
   *  persisted swap / complete / reset dropped it, the pending flush must not resurrect stale deltas. */
  growInflightIfCurrent: (messageId: string, delta: string) => void;
  clearInflight: () => void;
  /** P1b jump-restore: raise the mounted window so restored pages are not immediately re-trimmed. */
  widenWindow: () => void;
  /** P1b: after a restore settles, the jump control stays up only while older rows are still missing. */
  settleRestore: (filled: boolean) => void;
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
  activity?: ChatActivityView;
}

// P1b: after any entries growth, slide the mounted window forward — drop the oldest rows, keep the newest, and make
// the dropped range reachable again by re-pointing nextBefore at the new window edge (timelineHistory({ before: edge })
// returns exactly the trimmed rows plus anything older). Unconditional on trim: nextBefore can only have pointed at a
// row that the trim itself dropped. Idempotent when nothing overflows.
function withWindow(
  state: ChatTimelineStore,
  patch: Partial<ChatTimelineStore>,
): Partial<ChatTimelineStore> {
  const merged = { ...state, ...patch };
  if (merged.entries.length <= merged.windowLimit) return patch;
  const entries = merged.entries.slice(-merged.windowLimit);
  return { ...patch, entries, nextBefore: entries[0]!.seq, truncated: true };
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
  return mergeTimelineEntries(retained, incoming);
}

function reconcileHistory(state: ChatTimelineStore, entries: TimelineEntry[]): Partial<ChatTimelineStore> {
  return reconcileActivityHistory(state.live, entries);
}

function reconciledCursor({ page, baseline }: TimelineReconciliation): number | null {
  if (!baseline.loaded || page.nextBefore === null) return page.nextBefore;
  const oldTail = baseline.seqs.size > 0 ? Math.max(...baseline.seqs) : 0;
  // Keeping an exhausted old cursor across a disjoint newest page would make its missing middle unreachable.
  return page.nextBefore > oldTail ? page.nextBefore : baseline.nextBefore;
}

function activityActions(set: StoreApi<ChatTimelineStore>["setState"]) {
  return {
    appendLive: (entry: TimelineEntry) => set((state) => withWindow(state, {
      live: stageTimelineEntry(state.live, entry),
      entries: entry.presentation ? state.entries : mergeTimelineEntries(state.entries, [entry]),
      inflight: !entry.presentation && entry.role === "assistant" ? null : state.inflight,
    })),
    applyActivity: (view: ChatActivityView) => set((state) => {
      const live = applyTimelineActivity({ state: state.live, view, entries: state.entries });
      const terminal = view.snapshot.status === "terminal"
        || (view.snapshot.status === "unavailable" && view.snapshot.terminal !== undefined);
      return withWindow(state, { ...(terminal ? reconcileActivityHistory(live, state.entries) : { live }),
        inflight: view.snapshot.status === "idle" ? state.inflight : null });
    }),
    commitBatch: (batch: TimelineCommitted) => set((state) => withWindow(state, {
      entries: mergeTimelineEntries(state.entries, batch.entries), live: commitTimelineActivity(state.live, batch),
      inflight: state.inflight?.messageId === batch.messageId ? null : state.inflight,
    })),
    markActivityStale: () => set((state) => ({ live: staleTimelineActivity(state.live) })),
  };
}

export const useChatTimelineStore = create<ChatTimelineStore>()((set) => ({
  entries: [],
  nextBefore: null,
  loaded: false,
  inflight: null,
  live: emptyTimelineActivity(),
  windowLimit: TIMELINE_MOUNT_CAP,
  truncated: false,
  mergeHistory: (page) =>
    set((state) => withWindow(state, {
      ...reconcileHistory(state, mergeTimelineEntries(state.entries, page.entries)), nextBefore: page.nextBefore, loaded: true,
    })),
  reconcileLatest: (input) =>
    set((state) => {
      const entries = reconcileLatestEntries(state, input);
      const live = input.activity ? applyTimelineActivity({ state: state.live, view: input.activity, entries }) : state.live;
      return withWindow(state, { ...reconcileActivityHistory(live, entries),
        nextBefore: reconciledCursor(input), loaded: true });
    }),
  prependOlder: (page) =>
    set((state) => withWindow(state, {
      ...reconcileHistory(state, mergeTimelineEntries(state.entries, page.entries)), nextBefore: page.nextBefore,
    })),
  ...activityActions(set),
  removeEntry: (seq) => set((state) => ({ entries: state.entries.filter((entry) => entry.seq !== seq),
    live: { ...state.live, pendingEntries: state.live.pendingEntries.filter((entry) => entry.seq !== seq) } })),
  growInflight: (messageId, delta) =>
    set((state) => ({
      inflight:
        state.inflight?.messageId === messageId
          ? { messageId, text: state.inflight.text + delta }
          : { messageId, text: delta },
    })),
  growInflightIfCurrent: (messageId, delta) =>
    set((state) =>
      state.inflight?.messageId === messageId
        ? { inflight: { messageId, text: state.inflight.text + delta } }
        : state), // returning the same state = a true no-op: no store notification, no re-render
  clearInflight: () => set({ inflight: null }),
  widenWindow: () => set((state) => ({ windowLimit: state.windowLimit + TIMELINE_RESTORE_STEP })),
  settleRestore: (filled) =>
    set((state) => ({ truncated: !filled && state.nextBefore !== null })),
  reset: () =>
    set({ entries: [], nextBefore: null, loaded: false, inflight: null, live: emptyTimelineActivity(),
      windowLimit: TIMELINE_MOUNT_CAP, truncated: false }),
}));
