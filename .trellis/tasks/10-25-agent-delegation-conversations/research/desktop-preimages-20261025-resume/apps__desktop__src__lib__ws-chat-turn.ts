/**
 * INPUT:  one chat.send acknowledgement and validated legacy chat notifications from its physical client
 * OUTPUT: exact Character/message matching, bounded acknowledgement-race buffering and one local settlement
 * POS:    ui/lib — initiating request lifecycle only; shared activity/history owns visible conversation recovery
 */
import {
  CHAT_ACTIVITY_MAX_ITEMS, CHAT_ACTIVITY_MAX_TEXT_BYTES, utf8TextBytes,
  type ChatComplete, type ChatDelta, type ChatError, type ChatSendResult, type ErrorCode,
} from "@taki/shared";

export interface ChatHandlers {
  onAccepted?: (result: ChatSendResult) => void;
  onDelta: (delta: string, messageId: string) => void;
  onComplete?: () => void;
  onError?: (code: ErrorCode, message: string, retracted?: boolean) => void;
}

type ChatNotification =
  | { kind: "delta"; value: ChatDelta }
  | { kind: "complete"; value: ChatComplete }
  | { kind: "error"; value: ChatError };

export interface PendingChatTurn {
  characterId: string;
  handlers: ChatHandlers;
  accepted?: ChatSendResult;
  early: ChatNotification[];
  earlyBytes: number;
  overflowed: boolean;
  done: Promise<void>;
  finish(): void;
}

interface TurnSlot { current: PendingChatTurn | null }

export async function sendChatTurn(input: {
  slot: TurnSlot; characterId: string; handlers: ChatHandlers; request(): Promise<ChatSendResult>;
}): Promise<void> {
  if (input.slot.current) throw new Error("当前连接已有等待中的对话。");
  const turn = createPendingChatTurn(input.characterId, input.handlers);
  input.slot.current = turn;
  try {
    acceptChatTurn({ slot: input.slot, turn, result: await input.request() });
  } catch (cause) {
    if (input.slot.current === turn) input.slot.current = null;
    throw cause;
  }
  await turn.done;
}

export function createPendingChatTurn(characterId: string, handlers: ChatHandlers): PendingChatTurn {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  return { characterId, handlers, early: [], earlyBytes: 0, overflowed: false, done, finish };
}

export function acceptChatTurn(input: { slot: TurnSlot; turn: PendingChatTurn; result: ChatSendResult }): void {
  const { slot, turn, result } = input;
  if (slot.current !== turn) return;
  turn.accepted = result;
  notify(() => turn.handlers.onAccepted?.(result));
  const early = turn.early.splice(0);
  // A pathological pre-ack flood cannot be presented as a complete reply. The independent activity reader
  // restores visible content; this local waiter reports the gap without retrying or cancelling execution.
  if (turn.overflowed) {
    abortPendingChatTurn(slot, "回复状态更新超出本地缓冲范围，请在聊天记录中查看完整回复。");
    return;
  }
  for (const event of early) routeChatNotification(slot, event);
}

export function routeChatNotification(slot: TurnSlot, event: ChatNotification): void {
  const turn = slot.current;
  if (!turn || turn.characterId !== event.value.characterId) return;
  if (!turn.accepted) {
    const bytes = event.kind === "delta" ? utf8TextBytes(event.value.delta)
      : event.kind === "error" ? utf8TextBytes(event.value.message) : 0;
    if (turn.early.length >= CHAT_ACTIVITY_MAX_ITEMS || turn.earlyBytes + bytes > CHAT_ACTIVITY_MAX_TEXT_BYTES) {
      turn.early.length = 0;
      turn.overflowed = true;
    } else if (!turn.overflowed) {
      turn.early.push(event);
      turn.earlyBytes += bytes;
    }
    return;
  }
  if (turn.accepted.messageId !== event.value.messageId) return;
  if (event.kind === "delta") {
    notify(() => turn.handlers.onDelta(event.value.delta, event.value.messageId));
    return;
  }
  slot.current = null;
  if (event.kind === "complete") notify(() => turn.handlers.onComplete?.());
  else notify(() => turn.handlers.onError?.(event.value.code, event.value.message, event.value.retracted));
  turn.finish();
}

export function abortPendingChatTurn(slot: TurnSlot, message: string): void {
  const turn = slot.current;
  slot.current = null;
  if (!turn) return;
  turn.early.length = 0;
  notify(() => turn.handlers.onError?.("INTERNAL_ERROR", message));
  turn.finish();
}

function notify(callback: () => void): void {
  try { callback(); } catch { console.warn("[ws-client] chat handler failed"); }
}
