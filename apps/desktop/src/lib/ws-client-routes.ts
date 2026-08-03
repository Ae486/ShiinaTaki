/**
 * INPUT:  inbound JSON-RPC notification frames from the Core (chat stream + avatar/timeline/config pushes) and the
 *         transport's open/message/close events.
 * OUTPUT: Routes state (in-flight turn + push slots), installRoutes(), parseFrame(), abortTurn(), bindTransport().
 * POS:    ui/lib — the inbound half of ws-client: THE zod boundary (past it, data is trusted typed data). No
 *         React/Tauri imports; node-testable through the injected transport.
 */

import type { JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  AvatarCommandSchema,
  CHAT_METHODS,
  CONFIG_METHODS,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ConfigChangedSchema,
  JsonRpcClientFrameSchema,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineRemovedSchema,
  type AvatarCommand,
  type ConfigChanged,
  type ErrorCode,
  type JsonRpcClientFrame,
  type TimelineEntry,
  type TimelineRemoved,
} from "@taki/shared";
import type { WsTransport } from "./ws-transport.ts";

/** Streamed-turn callbacks: deltas append into the bubble, complete/error settle it (mirrors the CLI's ChatHandlers). */
export interface ChatHandlers {
  // messageId keys the in-flight assistant row (the chat page drops it when its persisted entry arrives, #17).
  onDelta: (delta: string, messageId: string) => void;
  onComplete?: () => void;
  // retracted=true means the turn was cancelled before any reply: the user row is already gone (timeline.removed),
  // so the caller restores the draft instead of surfacing the message as an error toast (cancel-retract).
  onError?: (code: ErrorCode, message: string, retracted?: boolean) => void;
}

interface Turn {
  handlers: ChatHandlers;
  finish: () => void;
}

interface PushSlots {
  avatar: ((command: AvatarCommand) => void) | null;
  timeline: ((entry: TimelineEntry) => void) | null;
  timelineRemoved: ((ref: TimelineRemoved) => void) | null;
  config: ((changed: ConfigChanged) => void) | null;
}

export interface Routes {
  current: Turn | null;
  push: PushSlots;
}

export function createRoutes(): Routes {
  return { current: null, push: { avatar: null, timeline: null, timelineRemoved: null, config: null } };
}

/** Routes the Core's notifications (chat stream + avatar/timeline/config pushes) to their handlers; each zod-validated. */
export function installRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  const endTurn = (act: (turn: Turn) => void): void => {
    const turn = state.current;
    state.current = null;
    if (turn) act(turn);
  };
  rpc.addMethod(CHAT_METHODS.delta, (params: unknown) => {
    const { delta, messageId } = ChatDeltaSchema.parse(params);
    state.current?.handlers.onDelta(delta, messageId);
  });
  rpc.addMethod(CHAT_METHODS.complete, (params: unknown) => {
    ChatCompleteSchema.parse(params);
    endTurn((turn) => {
      turn.handlers.onComplete?.();
      turn.finish();
    });
  });
  rpc.addMethod(CHAT_METHODS.error, (params: unknown) => {
    const { code, message, retracted } = ChatErrorSchema.parse(params);
    endTurn((turn) => {
      turn.handlers.onError?.(code, message, retracted);
      turn.finish();
    });
  });
  // Fire-and-forget pushes: a missing handler is harmless (closing a client window must not break a turn, invariant 4).
  rpc.addMethod(AVATAR_METHODS.command, (params: unknown) => {
    state.push.avatar?.(AvatarCommandSchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.appended, (params: unknown) => {
    state.push.timeline?.(TimelineAppendedSchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.removed, (params: unknown) => {
    state.push.timelineRemoved?.(TimelineRemovedSchema.parse(params));
  });
  rpc.addMethod(CONFIG_METHODS.changed, (params: unknown) => {
    state.push.config?.(ConfigChangedSchema.parse(params));
  });
}

/** The message a mid-turn disconnect settles the in-flight turn with (D29): callers see a real error, never a hang. */
export const CONNECTION_LOST_MESSAGE = "连接已断开，本轮回复中断";

/**
 * D29: the socket died mid-turn, so chat.complete/error can never arrive. Settle the turn through its error path so
 * the caller's await resolves and its isSending clears — a silently pending turn wedges the composer until reload.
 */
export function abortTurn(state: Routes, message: string): void {
  const turn = state.current;
  state.current = null;
  if (!turn) return;
  turn.handlers.onError?.("INTERNAL_ERROR", message);
  turn.finish();
}

/** null = not a valid client frame; the caller drops it (never a silent swallow that corrupts routing). */
export function parseFrame(text: string): JsonRpcClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const frame = JsonRpcClientFrameSchema.safeParse(parsed);
  return frame.success ? frame.data : null;
}

export interface TransportBinding {
  /** Resolves once the socket is open (requests must not be sent before the handshake can travel). */
  whenOpen: () => Promise<void>;
  /** True once the socket died: a new turn on a dead socket is rejected instead of left pending (D29). */
  isClosed: () => boolean;
}

/** Wires a transport's open/message/close events into the routes + rpc pair, including the D29 close settlement. */
export function bindTransport(transport: WsTransport, rpc: JSONRPCServerAndClient, state: Routes): TransportBinding {
  let opened = false;
  let closed = false;
  const openWaiters: Array<() => void> = [];
  transport.onOpen(() => {
    opened = true;
    for (const wake of openWaiters.splice(0)) wake();
  });
  transport.onMessage((data) => {
    const frame = parseFrame(data);
    if (frame) void rpc.receiveAndSend(frame);
  });
  transport.onClose(() => {
    closed = true;
    rpc.rejectAllPendingRequests("connection closed");
    abortTurn(state, CONNECTION_LOST_MESSAGE);
  });
  return {
    whenOpen: () => (opened ? Promise.resolve() : new Promise<void>((resolve) => openWaiters.push(resolve))),
    isClosed: () => closed,
  };
}
