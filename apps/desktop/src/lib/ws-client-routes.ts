/**
 * INPUT:  inbound JSON-RPC notification frames from the Core (chat stream + avatar/timeline/config/Approval pushes) and the
 *         transport's open/message/close events.
 * OUTPUT: Routes state (in-flight turn + push slots), installRoutes(), parseFrame(), abortTurn(), bindTransport().
 * POS:    ui/lib — the inbound half of ws-client: THE zod boundary (past it, data is trusted typed data). No
 *         React/Tauri imports; node-testable through the injected transport.
 */

import type { JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  APPROVAL_METHODS,
  ApprovalClosedSchema,
  CanonicalApprovalRequestSchema,
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
  type ApprovalClosed,
  type CanonicalApprovalRequest,
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
  config: Set<(changed: ConfigChanged) => void>;
  approval: Set<(event: ApprovalPushEvent) => void>;
}

export type ApprovalPushEvent =
  | { type: "request"; request: CanonicalApprovalRequest }
  | { type: "closed"; closed: ApprovalClosed };

export interface Routes {
  current: Turn | null;
  push: PushSlots;
}

export function createRoutes(): Routes {
  return { current: null, push: { avatar: null, timeline: null, timelineRemoved: null, config: new Set(), approval: new Set() } };
}

export function addConfigChangedHandler(state: Routes, handler: (changed: ConfigChanged) => void): () => void {
  state.push.config.add(handler);
  return () => state.push.config.delete(handler);
}

export function addApprovalHandler(state: Routes, handler: (event: ApprovalPushEvent) => void): () => void {
  state.push.approval.add(handler);
  return () => state.push.approval.delete(handler);
}

/** Retires every connection-scoped push sink before queued notifications can dispatch on a closed transport. */
function clearPushHandlers(state: Routes): void {
  state.push.avatar = null;
  state.push.timeline = null;
  state.push.timelineRemoved = null;
  state.push.config.clear();
  state.push.approval.clear();
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
    const changed = ConfigChangedSchema.parse(params);
    for (const handler of [...state.push.config]) {
      try {
        handler(changed);
      } catch (cause) {
        console.warn("[ws-client] config.changed handler failed", cause);
      }
    }
  });
  installApprovalRoutes(rpc, state);
}

function installApprovalRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(APPROVAL_METHODS.request, (params: unknown) => {
    const request = CanonicalApprovalRequestSchema.parse(params);
    notifyApprovalHandlers(state, { type: "request", request });
  });
  rpc.addMethod(APPROVAL_METHODS.closed, (params: unknown) => {
    const closed = ApprovalClosedSchema.parse(params);
    notifyApprovalHandlers(state, { type: "closed", closed });
  });
}

function notifyApprovalHandlers(state: Routes, event: ApprovalPushEvent): void {
  for (const handler of [...state.push.approval]) {
    try {
      handler(event);
    } catch {
      console.warn("[ws-client] Approval handler failed");
    }
  }
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
  whenOpen: (timeoutMs: number) => Promise<void>;
  /** True once the socket died: a new turn on a dead socket is rejected instead of left pending (D29). */
  isClosed: () => boolean;
  /** Synchronously retires connection-scoped work before an asynchronous browser close event can arrive. */
  retire: () => void;
}

export class WsOpenDeadlineExceededError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`WebSocket did not open within ${timeoutMs}ms`);
    this.name = "WsOpenDeadlineExceededError";
    this.timeoutMs = timeoutMs;
  }
}

interface OpenWaiter {
  resolve: () => void;
  reject: (cause: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function settleOpenWaiters(waiters: OpenWaiter[], cause?: Error): void {
  for (const waiter of waiters.splice(0)) {
    clearTimeout(waiter.timer);
    if (cause) waiter.reject(cause);
    else waiter.resolve();
  }
}

function waitForOpen(transport: WsTransport, waiters: OpenWaiter[], timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiter: OpenWaiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        transport.close();
        reject(new WsOpenDeadlineExceededError(timeoutMs));
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
}

/** Wires a transport's open/message/close events into the routes + rpc pair, including the D29 close settlement. */
export function bindTransport(transport: WsTransport, rpc: JSONRPCServerAndClient, state: Routes): TransportBinding {
  let opened = false;
  let closed = false;
  const openWaiters: OpenWaiter[] = [];
  const retire = (): void => {
    if (closed) return;
    closed = true;
    const error = new Error(CONNECTION_LOST_MESSAGE);
    settleOpenWaiters(openWaiters, error);
    clearPushHandlers(state);
    rpc.rejectAllPendingRequests("connection closed");
    abortTurn(state, CONNECTION_LOST_MESSAGE);
  };
  transport.onOpen(() => {
    if (closed || opened) return;
    opened = true;
    settleOpenWaiters(openWaiters);
  });
  transport.onMessage((data) => {
    if (closed) return;
    const frame = parseFrame(data);
    if (frame) void rpc.receiveAndSend(frame);
  });
  transport.onClose(retire);
  return {
    whenOpen: (timeoutMs) =>
      opened
        ? Promise.resolve()
        : closed
          ? Promise.reject(new Error(CONNECTION_LOST_MESSAGE))
          : waitForOpen(transport, openWaiters, timeoutMs),
    isClosed: () => closed,
    retire,
  };
}
