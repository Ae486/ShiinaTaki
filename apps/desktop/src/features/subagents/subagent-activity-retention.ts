/**
 * INPUT: observed scoped snapshots, complete canonical coverage and a window-owned retention map
 * OUTPUT: bounded observed history or explicit capacity unavailability without evicting displayed text
 * POS: ui/subagents — additional live memory only; complete conversation pages remain the read authority
 */
import { CHAT_ACTIVITY_MAX_TEXT_BYTES, utf8TextBytes, type SubagentActivityReadResult, type SubagentConversationEntry } from "@taki/shared";
import type { ChatActivityView } from "@/lib/chat-activity-state.js";
import { activityItemKey } from "@/lib/chat-activity-state.js";
import { completePrivateItem } from "./subagent-live-coverage.ts";

export const PRIVATE_ACTIVITY_MAX_SNAPSHOTS = 4;
export const PRIVATE_ACTIVITY_MAX_BYTES = 4 * CHAT_ACTIVITY_MAX_TEXT_BYTES;
export interface SubagentLiveView {
  view: ChatActivityView;
  metadata: SubagentActivityReadResult | null;
  positions?: Map<string, number>;
  retained?: SubagentLiveView[];
  retainedBytes?: number;
  capacity?: boolean;
}

export function privateActivityBytes(value: SubagentLiveView): number {
  return utf8TextBytes(JSON.stringify({ view: value.view, metadata: value.metadata, positions: [...value.positions ?? []] }));
}

export function rememberPrivateActivity(previous: Map<string, SubagentLiveView>, current: SubagentLiveView,
  context: { entries: SubagentConversationEntry[]; tailSeq: number; subagentId?: string }): SubagentLiveView {
  const { snapshot } = current.view;
  const positions = new Map<string, number>();
  if ("items" in snapshot) for (const item of snapshot.items) {
    const key = activityItemKey(snapshot.messageId, item.itemId);
    positions.set(key, current.positions?.get(key) ?? previous.get(snapshot.messageId)?.positions?.get(key) ?? context.tailSeq + 0.5);
  }
  for (const [key, retained] of previous) if (fullyCovered(retained, context.entries)) previous.delete(key);
  const currentView = { view: current.view, metadata: current.metadata, positions };
  if (snapshot.status !== "idle" && snapshot.status !== "unavailable" && !fullyCovered(currentView, context.entries)) {
    const retainedBytes = privateActivityBytes(currentView);
    const others = [...previous].filter(([key]) => key !== snapshot.messageId);
    const bytes = others.reduce((total, [, value]) => total + (value.retainedBytes ?? privateActivityBytes(value)), retainedBytes);
    if (others.length >= PRIVATE_ACTIVITY_MAX_SNAPSHOTS || bytes > PRIVATE_ACTIVITY_MAX_BYTES) {
      return capacityView(previous, currentView, context.subagentId);
    }
    previous.set(snapshot.messageId, { ...currentView, retainedBytes });
  }
  const messageId = snapshot.status === "idle" || snapshot.status === "unavailable" ? null : snapshot.messageId;
  const child = context.subagentId ?? current.metadata?.subagentId;
  return { ...currentView, retained: [...previous].filter(([key, value]) => key !== messageId && belongsTo(value, child))
    .map(([, retained]) => ({ ...retained, view: { ...retained.view, stale: true } })) };
}

function fullyCovered(value: SubagentLiveView, entries: SubagentConversationEntry[]): boolean {
  const snapshot = value.view.snapshot;
  return "items" in snapshot && snapshot.items.every((item) => completePrivateItem(entries, { messageId: snapshot.messageId, itemId: item.itemId }));
}

function belongsTo(value: SubagentLiveView, child: string | undefined): boolean {
  return child === undefined || value.metadata?.subagentId === child;
}

function capacityView(previous: Map<string, SubagentLiveView>, current: SubagentLiveView, child?: string): SubagentLiveView {
  const snapshot = current.view.snapshot;
  if (snapshot.status === "idle") return current;
  const unavailable = { status: "unavailable" as const, characterId: snapshot.characterId, messageId: snapshot.messageId,
    runId: snapshot.runId, attemptId: snapshot.attemptId, seq: snapshot.seq, reason: "capacity" as const };
  return { view: { snapshot: unavailable, stale: true }, metadata: current.metadata ? { ...current.metadata, activity: unavailable } : null,
    capacity: true, retained: [...previous.values()].filter((value) => belongsTo(value, child ?? current.metadata?.subagentId))
      .map((value) => ({ ...value, view: { ...value.view, stale: true } })) };
}
