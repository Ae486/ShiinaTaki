/**
 * INPUT:  shared activity views, canonical row notifications and complete/history-recovered turn batches
 * OUTPUT: disposable pending handoffs that preserve visible text until its complete canonical replacement exists
 * POS:    ui/chat — atomic live/history projection state; never persists content or changes Core execution
 */
import { CHAT_ACTIVITY_MAX_ITEMS, type TimelineCommitted, type TimelineEntry } from "@taki/shared";
import { activityMessageId, type ChatActivityView } from "@/lib/chat-activity-state.js";
import { completeTimelineBatch, mergeTimelineEntries } from "./timeline-batch.ts";

export interface TimelineLiveTurn {
  view: ChatActivityView;
  anchorSeq: number;
  createdAt: string;
  awaitingUser: boolean;
}

export interface TimelineActivityState {
  turns: TimelineLiveTurn[];
  pendingEntries: TimelineEntry[];
  covered: ReadonlySet<string>;
}

export function emptyTimelineActivity(): TimelineActivityState {
  return { turns: [], pendingEntries: [], covered: new Set() };
}

export function applyTimelineActivity(input: {
  state: TimelineActivityState; view: ChatActivityView; entries: readonly TimelineEntry[];
}): TimelineActivityState {
  const { state, view, entries } = input;
  const messageId = activityMessageId(view.snapshot);
  if (!messageId) {
    return view.stale ? staleTimelineActivity(state) : { ...state, turns: state.turns.filter(hasItems) };
  }
  if (state.covered.has(messageId)) return state;
  const committed = completeTimelineBatch(entries, messageId);
  if (committed) return commitTimelineActivity(state, committed);
  const existing = state.turns.find((turn) => activityMessageId(turn.view.snapshot) === messageId);
  if (existing && existing.view.snapshot.status !== "idle" && view.snapshot.status !== "idle"
    && existing.view.snapshot.seq > view.snapshot.seq) return state;
  const tail = entries.at(-1);
  const next: TimelineLiveTurn = existing ? { ...existing, view } : {
    view, anchorSeq: tail?.seq ?? 0, createdAt: tail?.createdAt ?? new Date().toISOString(),
    awaitingUser: view.snapshot.status === "active" && view.snapshot.items.length === 0,
  };
  return { ...state, turns: existing ? state.turns.map((turn) => turn === existing ? next : turn) : [...state.turns, next] };
}

function hasItems(turn: TimelineLiveTurn): boolean {
  return "items" in turn.view.snapshot && turn.view.snapshot.items.length > 0;
}

export function staleTimelineActivity(state: TimelineActivityState): TimelineActivityState {
  return { ...state, turns: state.turns.map((turn) => ({ ...turn, view: { ...turn.view, stale: true } })) };
}

export function stageTimelineEntry(state: TimelineActivityState, entry: TimelineEntry): TimelineActivityState {
  if (entry.presentation) return state.covered.has(entry.presentation.messageId) ? state
    : { ...state, pendingEntries: mergeTimelineEntries(state.pendingEntries, [entry]) };
  if (entry.role !== "user") return state;
  return { ...state, turns: state.turns.map((turn) => turn.awaitingUser
    ? { ...turn, anchorSeq: entry.seq, createdAt: entry.createdAt, awaitingUser: false } : turn) };
}

export function commitTimelineActivity(state: TimelineActivityState, batch: TimelineCommitted): TimelineActivityState {
  const covered = new Set(state.covered).add(batch.messageId);
  // Only guards delayed callbacks; canonical entries, not these bounded markers, are the history authority.
  if (covered.size > CHAT_ACTIVITY_MAX_ITEMS) {
    const first = covered.values().next().value;
    if (first) covered.delete(first);
  }
  return { covered, turns: state.turns.filter((turn) => activityMessageId(turn.view.snapshot) !== batch.messageId),
    pendingEntries: state.pendingEntries.filter((entry) => entry.presentation?.messageId !== batch.messageId) };
}

export function reconcileActivityHistory(state: TimelineActivityState, entries: TimelineEntry[]): {
  live: TimelineActivityState; entries: TimelineEntry[];
} {
  const all = mergeTimelineEntries(entries, state.pendingEntries);
  const candidates = new Set([
    ...state.turns.map((turn) => activityMessageId(turn.view.snapshot)),
    ...state.pendingEntries.map((entry) => entry.presentation?.messageId),
  ]);
  let live = state;
  let committed = entries;
  for (const messageId of candidates) {
    const batch = messageId ? completeTimelineBatch(all, messageId) : null;
    if (!batch) continue;
    live = commitTimelineActivity(live, batch);
    committed = mergeTimelineEntries(committed, batch.entries);
  }
  return { live, entries: committed };
}
