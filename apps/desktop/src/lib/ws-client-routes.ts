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
  ChatActivitySchema,
  ConfigChangedSchema,
  OBSERVABILITY_METHODS,
  RunMonitorEventSchema,
  JsonRpcClientFrameSchema,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineRemovedSchema,
  TimelineCommittedSchema,
  type ChatActivity,
  type AvatarCommand,
  type ApprovalClosed,
  type CanonicalApprovalRequest,
  type ConfigChanged,
  type RunMonitorEvent,
  type JsonRpcClientFrame,
  type TimelineEntry,
  type TimelineRemoved,
  type TimelineCommitted,
} from "@taki/shared";
import type { WsTransport } from "./ws-transport.ts";
import { abortPendingChatTurn, routeChatNotification, type PendingChatTurn } from "./ws-chat-turn.ts";

interface PushSlots {
  avatar: ((command: AvatarCommand) => void) | null;
  timeline: ((entry: TimelineEntry) => void) | null;
  timelineRemoved: ((ref: TimelineRemoved) => void) | null;
  config: Set<(changed: ConfigChanged) => void>;
  approval: Set<(event: ApprovalPushEvent) => void>;
  monitor: Set<(event: RunMonitorEvent) => void>;
  activity: Set<(event: ChatActivity) => void>;
  committed: Set<(batch: TimelineCommitted) => void>;
}

export type ApprovalPushEvent =
  | { type: "request"; request: CanonicalApprovalRequest }
  | { type: "closed"; closed: ApprovalClosed };

export interface Routes {
  current: PendingChatTurn | null;
  push: PushSlots;
}

export function createRoutes(): Routes {
  return { current: null, push: { avatar: null, timeline: null, timelineRemoved: null, config: new Set(),
    approval: new Set(), monitor: new Set(), activity: new Set(), committed: new Set() } };
}

export function addChatActivityHandler(state: Routes, handler: (event: ChatActivity) => void): () => void {
  state.push.activity.add(handler);
  return () => state.push.activity.delete(handler);
}

export function addTimelineCommittedHandler(state: Routes, handler: (batch: TimelineCommitted) => void): () => void {
  state.push.committed.add(handler);
  return () => state.push.committed.delete(handler);
}

export function addConfigChangedHandler(state: Routes, handler: (changed: ConfigChanged) => void): () => void {
  state.push.config.add(handler);
  return () => state.push.config.delete(handler);
}

export function addApprovalHandler(state: Routes, handler: (event: ApprovalPushEvent) => void): () => void {
  state.push.approval.add(handler);
  return () => state.push.approval.delete(handler);
}
export function addMonitorHandler(state: Routes, handler: (event: RunMonitorEvent) => void): () => void { state.push.monitor.add(handler); return () => state.push.monitor.delete(handler); }

function notifyMonitorHandlers(state: Routes, event: RunMonitorEvent): void {
  for (const handler of [...state.push.monitor]) {
    try { handler(event); } catch { console.warn("[ws-client] monitor handler failed"); }
  }
}

/** Retires every connection-scoped push sink before queued notifications can dispatch on a closed transport. */
function clearPushHandlers(state: Routes): void {
  state.push.avatar = null;
  state.push.timeline = null;
  state.push.timelineRemoved = null;
  state.push.config.clear();
  state.push.approval.clear();
  state.push.monitor.clear();
  state.push.activity.clear();
  state.push.committed.clear();
}

/** Routes the Core's notifications (chat stream + avatar/timeline/config pushes) to their handlers; each zod-validated. */
export function installRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(CHAT_METHODS.delta, (params: unknown) => {
    routeChatNotification(state, { kind: "delta", value: ChatDeltaSchema.parse(params) });
  });
  rpc.addMethod(CHAT_METHODS.complete, (params: unknown) => {
    routeChatNotification(state, { kind: "complete", value: ChatCompleteSchema.parse(params) });
  });
  rpc.addMethod(CHAT_METHODS.error, (params: unknown) => {
    routeChatNotification(state, { kind: "error", value: ChatErrorSchema.parse(params) });
  });
  rpc.addMethod(CHAT_METHODS.activity, (params: unknown) => {
    publishHandlers(state.push.activity, ChatActivitySchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.committed, (params: unknown) => {
    publishHandlers(state.push.committed, TimelineCommittedSchema.parse(params));
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
  rpc.addMethod(OBSERVABILITY_METHODS.event, (params: unknown) => {
    notifyMonitorHandlers(state, RunMonitorEventSchema.parse(params));
  });
  installApprovalRoutes(rpc, state);
}

function publishHandlers<T>(handlers: Set<(value: T) => void>, value: T): void {
  for (const handler of [...handlers]) {
    try { handler(value); } catch { console.warn("[ws-client] activity/timeline handler failed"); }
  }
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
  abortPendingChatTurn(state, message);
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
