/**
 * INPUT:  started foreground identities and ordered Core activity facts
 * OUTPUT: latest-per-Character disposable snapshots with incremental 512-item / 1-MiB display-text bounds
 * POS:    core/agents — runtime-owned recovery view; overflow is explicit and never truncates canonical persistence
 */
import {
  CHAT_ACTIVITY_MAX_ITEMS, CHAT_ACTIVITY_MAX_TEXT_BYTES, appendedUtf8TextBytes, chatActivityItemTextBytes, utf8TextBytes,
  type ChatActivity, type ChatActivityIdentity, type ChatActivityItem, type ChatActivityReadResult, type ChatActivityTerminal,
} from "@taki/shared";

export interface ChatActivityProjection {
  /** Called only by the current Character queue owner, immediately before its turn.started event. */
  start(identity: ChatActivityIdentity): void;
  apply(event: ChatActivity): boolean;
  read(characterId: string): ChatActivityReadResult;
  dispose(): void;
}
interface TurnProjection {
  identity: ChatActivityIdentity;
  seq: number;
  items: Map<string, ChatActivityItem>;
  bytes: number;
  unavailable: boolean;
  terminal?: ChatActivityTerminal;
}

export function createChatActivityProjection(): ChatActivityProjection {
  const turns = new Map<string, TurnProjection>();
  let disposed = false;
  return {
    start(identity) {
      if (disposed) return;
      turns.set(identity.characterId, { identity: { ...identity }, seq: 0, items: new Map(), bytes: 0, unavailable: false });
    },
    apply(event) {
      const turn = turns.get(event.characterId);
      if (disposed || !turn || turn.identity.messageId !== event.messageId || turn.terminal || event.seq <= turn.seq) return false;
      turn.seq = event.seq;
      turn.identity = { characterId: event.characterId, messageId: event.messageId, runId: event.runId, attemptId: event.attemptId };
      applyEvent(turn, event);
      return true;
    },
    read(characterId) {
      const turn = turns.get(characterId);
      if (!turn) return { status: "idle", characterId };
      const identity = { ...turn.identity, seq: turn.seq };
      if (turn.unavailable) return { ...identity, status: "unavailable", reason: "capacity",
        ...(turn.terminal ? { terminal: { ...turn.terminal } } : {}) };
      const items = [...turn.items.values()].sort((left, right) => left.order - right.order).map(copyItem);
      return turn.terminal ? { ...identity, status: "terminal", ...turn.terminal, items }
        : { ...identity, status: "active", items };
    },
    dispose() { disposed = true; turns.clear(); },
  };
}

function applyEvent(turn: TurnProjection, event: ChatActivity): void {
  if (event.kind === "turn.terminal") {
    turn.terminal = { outcome: event.outcome, ...(event.message ? { message: event.message } : {}) };
    turn.bytes += utf8TextBytes(event.message ?? "");
  } else if (!turn.unavailable) applyItem(turn, event);
  if (turn.items.size > CHAT_ACTIVITY_MAX_ITEMS || turn.bytes > CHAT_ACTIVITY_MAX_TEXT_BYTES) {
    turn.unavailable = true;
    turn.items.clear();
    turn.bytes = 0;
  }
}

function applyItem(turn: TurnProjection, event: Exclude<ChatActivity, { kind: "turn.terminal" }>): void {
  if (event.kind === "turn.started") return;
  const previous = turn.items.get(event.itemId);
  if (event.kind === "text.delta") {
    if (previous && previous.kind !== "text") return;
    const text = previous?.text ?? "";
    turn.bytes += appendedUtf8TextBytes(text, event.delta);
    turn.items.set(event.itemId, { kind: "text", itemId: event.itemId, order: event.order, text: text + event.delta });
  } else if (event.kind === "tool.received") {
    if (previous) return;
    const item: ChatActivityItem = {
      kind: "tool", itemId: event.itemId, order: event.order, toolCallId: event.toolCallId,
      toolName: event.toolName, ...(event.displayName ? { displayName: event.displayName } : {}), status: { phase: "received" },
    };
    turn.bytes += chatActivityItemTextBytes(item);
    turn.items.set(item.itemId, item);
  } else if (previous?.kind === "tool" && previous.status.phase !== "settled") {
    const status = event.kind === "tool.phase" ? { phase: event.phase } : {
      phase: "settled" as const, outcome: event.outcome,
      ...(event.message ? { message: event.message } : {}),
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    };
    const item = { ...previous, status };
    turn.bytes += chatActivityItemTextBytes(item) - chatActivityItemTextBytes(previous);
    turn.items.set(item.itemId, item);
  }
}

function copyItem(item: ChatActivityItem): ChatActivityItem {
  return item.kind === "text" ? { ...item } : { ...item, status: { ...item.status } };
}
