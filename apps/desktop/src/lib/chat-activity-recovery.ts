/**
 * INPUT:  one authenticated WsClient generation, Character identity and a disposable view sink
 * OUTPUT: subscribe/read/live reconciliation with bounded races, read-only gap recovery and teardown
 * POS:    ui/lib — shared Chat/Pet activity adapter; never resends chat.send, cancels a turn or stores durable data
 */
import {
  CHAT_ACTIVITY_MAX_ITEMS, CHAT_ACTIVITY_MAX_TEXT_BYTES, utf8TextBytes,
  type ChatActivity, type ChatActivityReadResult,
} from "@taki/shared";
import type { ConnectionGenerationContext } from "./connection-generation-controller.ts";
import { createChatActivityCoalescer } from "./chat-activity-coalescer.ts";
import { activityMessageId, activityNeedsRecovery, reduceChatActivity, type ChatActivityView } from "./chat-activity-state.ts";
import type { WsClient } from "./ws-client.ts";

export type ChatActivityClient = Pick<WsClient, "onChatActivity" | "chatActivityRead" | "subscribeTimeline" | "onClose">;
export interface ChatActivityRecovery {
  restore(): Promise<void>;
  refresh(): Promise<void>;
  flush(): void;
  dispose(): void;
}

interface RecoveryInput {
  client: ChatActivityClient;
  context: ConnectionGenerationContext;
  characterId: string;
  onChange(view: ChatActivityView): void;
}
interface RecoveryState {
  input: RecoveryInput;
  view: ChatActivityView;
  buffer: ChatActivity[];
  bytes: number;
  overflowed: boolean;
  buffering: boolean;
  disposed: boolean;
  pending: Promise<void> | null;
  retiredMessages: Set<string>;
  publish: ReturnType<typeof createChatActivityCoalescer>;
}

export function createChatActivityRecovery(input: RecoveryInput): ChatActivityRecovery {
  const state: RecoveryState = {
    input, view: { snapshot: { status: "idle", characterId: input.characterId }, stale: true },
    buffer: [], bytes: 0, overflowed: false, buffering: true, disposed: false, pending: null, retiredMessages: new Set(),
    publish: createChatActivityCoalescer((view) => { if (current(state)) input.onChange(view); }),
  };
  const unsubscribe = input.client.onChatActivity((event) => receive(state, event));
  const dispose = () => {
    if (state.disposed) return;
    state.publish.flush();
    if (current(state)) input.onChange({ ...state.view, stale: true });
    state.disposed = true;
    state.buffer = [];
    unsubscribe();
    state.publish.dispose();
  };
  input.client.onClose(dispose);
  return {
    async restore() {
      try {
        await input.client.subscribeTimeline(input.characterId);
        if (current(state)) await refresh(state);
      } catch (cause) { dispose(); throw cause; }
    },
    refresh: () => refresh(state),
    flush: () => state.publish.flush(),
    dispose,
  };
}

function current(state: RecoveryState): boolean {
  return !state.disposed && state.input.context.isCurrent();
}

function receive(state: RecoveryState, event: ChatActivity): void {
  if (!current(state) || event.characterId !== state.input.characterId || state.retiredMessages.has(event.messageId)) return;
  if (state.buffering) { bufferEvent(state, event); return; }
  if (activityNeedsRecovery(state.view.snapshot, event)) {
    state.buffering = true;
    bufferEvent(state, event);
    state.view = { ...state.view, stale: true };
    void refresh(state).catch(() => undefined); // refresh publishes the real failed-read state; no silent false freshness.
    return;
  }
  installEvent(state, event);
}

function bufferEvent(state: RecoveryState, event: ChatActivity): void {
  if (state.overflowed) {
    if (event.kind === "turn.started") {
      state.buffer = [event]; state.bytes = 0; state.overflowed = false;
    } else if (event.kind === "turn.terminal") state.buffer = [event];
    return;
  }
  const bytes = event.kind === "text.delta" ? utf8TextBytes(event.delta)
    : event.kind === "tool.received" ? utf8TextBytes(event.displayName ?? "")
      : "message" in event ? utf8TextBytes(event.message ?? "") : 0;
  if (state.buffer.length >= CHAT_ACTIVITY_MAX_ITEMS || state.bytes + bytes > CHAT_ACTIVITY_MAX_TEXT_BYTES) {
    state.buffer = []; state.bytes = 0; state.overflowed = true;
  } else { state.buffer.push(event); state.bytes += bytes; }
}

function installEvent(state: RecoveryState, event: ChatActivity): void {
  const previous = activityMessageId(state.view.snapshot);
  const snapshot = reduceChatActivity(state.view.snapshot, event);
  if (snapshot === state.view.snapshot) return;
  if (previous && previous !== activityMessageId(snapshot)) retireMessage(state, previous);
  state.view = { snapshot, stale: false };
  state.publish.record(state.view, event);
}

function retireMessage(state: RecoveryState, messageId: string): void {
  state.retiredMessages.add(messageId);
  // Use the existing adapter item budget for bounded duplicate-start guards, never an unbounded conversation ledger.
  if (state.retiredMessages.size > CHAT_ACTIVITY_MAX_ITEMS) {
    const first = state.retiredMessages.values().next().value;
    if (first) state.retiredMessages.delete(first);
  }
}

function refresh(state: RecoveryState): Promise<void> {
  if (!current(state)) return Promise.resolve();
  if (state.pending) return state.pending;
  if (state.view.snapshot.status === "unavailable" && !state.view.stale) return Promise.resolve();
  state.buffering = true;
  state.view = { ...state.view, stale: true };
  state.publish.replace(state.view);
  state.pending = readSnapshot(state).catch((cause: unknown) => {
    if (current(state)) {
      state.view = { ...state.view, stale: true };
      state.publish.replace(state.view);
      state.buffering = false;
    }
    throw cause;
  }).finally(() => { state.pending = null; });
  return state.pending;
}

async function readSnapshot(state: RecoveryState): Promise<void> {
  while (current(state)) {
    const snapshot = await state.input.client.chatActivityRead(state.input.characterId);
    if (!current(state)) return;
    if (snapshot.characterId !== state.input.characterId) throw new Error("Activity snapshot Character mismatch");
    if (state.overflowed && snapshot.status !== "unavailable") {
      state.buffer = []; state.bytes = 0; state.overflowed = false;
      continue; // A second read covers the discarded race; never reconstruct only its suffix.
    }
    installSnapshot(state, snapshot);
    if (!state.view.stale && !state.buffering) return;
    state.buffering = true;
  }
}

function installSnapshot(state: RecoveryState, snapshot: ChatActivityReadResult): void {
  const previous = activityMessageId(state.view.snapshot);
  const restored = activityMessageId(snapshot);
  if (previous && previous !== restored) retireMessage(state, previous);
  const buffer = state.buffer;
  // The physical socket is ordered. A restored newer message covers all buffered events before its first event.
  const restoredIndex = buffer.findIndex((event) => event.messageId === restored);
  state.view = { snapshot, stale: false };
  state.buffer = []; state.bytes = 0; state.overflowed = false; state.buffering = false;
  for (const event of buffer.slice(Math.max(0, restoredIndex))) {
    if (state.retiredMessages.has(event.messageId)) continue;
    if (activityNeedsRecovery(state.view.snapshot, event)) { state.view = { ...state.view, stale: true }; continue; }
    const before = activityMessageId(state.view.snapshot);
    const next = reduceChatActivity(state.view.snapshot, event);
    if (before && before !== activityMessageId(next)) retireMessage(state, before);
    state.view = { snapshot: next, stale: state.view.stale };
  }
  state.publish.replace(state.view);
}
