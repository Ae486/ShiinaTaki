/**
 * INPUT:  validated Core activity snapshots and ordered notifications for one Character
 * OUTPUT: immutable language/tool view updates and explicit detection of missing stream coverage
 * POS:    ui/lib — shared Chat/Pet read projection; no persistence, timing or execution authority
 */
import type {
  ChatActivity, ChatActivityItem, ChatActivityReadResult, ChatActivityToolStatus,
} from "@taki/shared";

export interface ChatActivityView {
  snapshot: ChatActivityReadResult;
  /** A connection retirement, missed event or failed read makes running indicators non-authoritative. */
  stale: boolean;
}

export function activityItemKey(messageId: string, itemId: string): string {
  return `activity:${JSON.stringify([messageId, itemId])}`;
}

export function activityMessageId(snapshot: ChatActivityReadResult): string | null {
  return snapshot.status === "idle" ? null : snapshot.messageId;
}

export function activityNeedsRecovery(snapshot: ChatActivityReadResult, event: ChatActivity): boolean {
  if (event.characterId !== snapshot.characterId || event.kind === "turn.started") return false;
  if (snapshot.status === "idle" || snapshot.messageId !== event.messageId) return true;
  if (event.seq <= snapshot.seq || snapshot.status === "terminal" || snapshot.status === "unavailable") return false;
  if (event.seq !== snapshot.seq + 1) return true;
  if (event.kind === "turn.terminal") return false;
  const item = snapshot.items.find((candidate) => candidate.itemId === event.itemId);
  if (event.kind === "tool.phase" || event.kind === "tool.terminal") return item?.kind !== "tool";
  if (item) return item.kind !== (event.kind === "text.delta" ? "text" : "tool") || item.order !== event.order;
  return snapshot.items.some((candidate) => candidate.order === event.order);
}

export function reduceChatActivity(snapshot: ChatActivityReadResult, event: ChatActivity): ChatActivityReadResult {
  if (event.characterId !== snapshot.characterId) return snapshot;
  const identity = { characterId: event.characterId, messageId: event.messageId,
    runId: event.runId, attemptId: event.attemptId, seq: event.seq };
  if (event.kind === "turn.started") {
    return activityMessageId(snapshot) === event.messageId ? snapshot : { ...identity, status: "active", items: [] };
  }
  if (snapshot.status === "idle" || snapshot.messageId !== event.messageId
    || event.seq <= snapshot.seq || snapshot.status === "terminal") return snapshot;
  if (snapshot.status === "unavailable") {
    const terminal = event.kind === "turn.terminal" ? { outcome: event.outcome, message: event.message } : snapshot.terminal;
    return { ...snapshot, ...identity, ...(terminal ? { terminal } : {}) };
  }
  if (event.kind === "turn.terminal") {
    return { ...identity, status: "terminal", outcome: event.outcome, message: event.message, items: snapshot.items };
  }
  const items = updateItems(snapshot.items, event);
  return items === snapshot.items ? snapshot : { ...snapshot, ...identity, items };
}

function updateItems(items: ChatActivityItem[], event: Exclude<ChatActivity, { kind: "turn.started" | "turn.terminal" }>): ChatActivityItem[] {
  const index = items.findIndex((item) => item.itemId === event.itemId);
  const previous = items[index];
  let next: ChatActivityItem;
  if (event.kind === "text.delta") {
    if (previous && previous.kind !== "text") return items;
    next = { kind: "text", itemId: event.itemId, order: event.order, text: (previous?.text ?? "") + event.delta };
  } else if (event.kind === "tool.received") {
    if (previous) return [...items];
    next = { kind: "tool", itemId: event.itemId, order: event.order, toolCallId: event.toolCallId,
      toolName: event.toolName, displayName: event.displayName, status: { phase: "received" } };
  } else {
    if (previous?.kind !== "tool") return items;
    // A late phase/result cannot reopen a settled invocation. Its sequence is still covered by the reducer.
    if (previous.status.phase === "settled") return [...items];
    const status: ChatActivityToolStatus = event.kind === "tool.phase" ? { phase: event.phase }
      : { phase: "settled", outcome: event.outcome, message: event.message, durationMs: event.durationMs };
    next = { ...previous, status };
  }
  if (index < 0) return [...items, next].sort((left, right) => left.order - right.order);
  const updated = [...items];
  updated[index] = next;
  return updated;
}
