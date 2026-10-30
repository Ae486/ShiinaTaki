/**
 * INPUT:  inbound JSON-RPC notification frames from the Core (chat stream and typed operator pushes) and the
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
  INTERACTION_PATTERN_METHODS, INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS,
  InteractionPatternChangedSchema,
  INITIATIVE_BACKOFF_METHODS, InitiativeBackoffChangedSchema,
  CO_WATCHING_METHODS, CoWatchingChangedSchema, type CoWatchingChanged,
  CONFIG_METHODS,
  MEMORY_OPERATION_METHODS,
  MemoryOperationChangedSchema,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatActivitySchema,
  ConfigChangedSchema,
  EXTENSION_METHODS,
  ExtensionChangedSchema,
  PERCEPTION_METHODS,
  PerceptionChangedSchema,
  OBSERVABILITY_METHODS,
  RunMonitorEventSchema,
  JsonRpcClientFrameSchema,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  TimelineRemovedSchema,
  TimelineCommittedSchema,
  type ChatActivity,
  type InteractionPatternChanged,
  type InitiativeBackoffChanged,
  type AvatarCommand,
  type ApprovalClosed,
  type CanonicalApprovalRequest,
  type ConfigChanged,
  type ExtensionChanged,
  type PerceptionChanged,
  type MemoryOperation,
  type RunMonitorEvent,
  type JsonRpcClientFrame,
  type TimelineEntry,
  type TimelineRemoved,
  type TimelineCommitted,
} from "@taki/shared";
import type { WsTransport } from "./ws-transport.ts";
import { SUBAGENT_METHODS, SubagentChangedSchema, SubagentActivitySchema, type SubagentChanged, type SubagentActivity } from "@taki/shared";
import { abortPendingChatTurn, routeChatNotification, type PendingChatTurn } from "./ws-chat-turn.ts";

interface PushSlots {
  subagentActivity: Set<(event: SubagentActivity) => void>;
  subagents: Set<(change: SubagentChanged) => void>;
  coWatching: Set<(change: CoWatchingChanged) => void>;
  initiativePatterns: Set<(change: InteractionPatternChanged) => void>;
  initiativeSetup: Set<(change: InteractionPatternChanged) => void>;
  initiativePolicy: Set<(change: InteractionPatternChanged) => void>;
  initiativeBackoff: Set<(change: InitiativeBackoffChanged) => void>;
  avatar: ((command: AvatarCommand) => void) | null;
  timeline: ((entry: TimelineEntry) => void) | null;
  timelineRemoved: ((ref: TimelineRemoved) => void) | null;
  config: Set<(changed: ConfigChanged) => void>;
  perception: Set<(changed: PerceptionChanged) => void>;
  extension: Set<(changed: ExtensionChanged) => void>;
  approval: Set<(event: ApprovalPushEvent) => void>;
  monitor: Set<(event: RunMonitorEvent) => void>;
  activity: Set<(event: ChatActivity) => void>;
  committed: Set<(batch: TimelineCommitted) => void>;
  memoryOperation: Set<(operation: MemoryOperation) => void>;
}

export type ApprovalPushEvent =
  | { type: "request"; request: CanonicalApprovalRequest }
  | { type: "closed"; closed: ApprovalClosed };

export interface Routes {
  current: PendingChatTurn | null;
  push: PushSlots;
}

export function createRoutes(): Routes {
  return { current: null, push: { subagentActivity: new Set(), subagents: new Set(), coWatching: new Set(), avatar: null, timeline: null, timelineRemoved: null, config: new Set(),
    initiativePatterns: new Set(), initiativeSetup: new Set(), initiativePolicy: new Set(), initiativeBackoff: new Set(),
    approval: new Set(), monitor: new Set(), memoryOperation: new Set(), activity: new Set(), committed: new Set(), perception: new Set(), extension: new Set() } };
}

export function addInitiativeChangedHandler(state: Routes,
  kind: "initiativePatterns" | "initiativeSetup" | "initiativePolicy" | "initiativeBackoff",
  handler: (change: InteractionPatternChanged) => void): () => void {
  state.push[kind].add(handler);
  return () => state.push[kind].delete(handler);
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

export function addCoWatchingChangedHandler(state: Routes, handler: (changed: CoWatchingChanged) => void): () => void {
  state.push.coWatching.add(handler);
  return () => state.push.coWatching.delete(handler);
}

export function addSubagentChangedHandler(state: Routes, handler: (changed: SubagentChanged) => void): () => void {
  state.push.subagents.add(handler);
  return () => state.push.subagents.delete(handler);
}

export function addSubagentActivityHandler(state: Routes, handler: (event: SubagentActivity) => void): () => void {
  state.push.subagentActivity.add(handler);
  return () => state.push.subagentActivity.delete(handler);
}

export function addPerceptionChangedHandler(state: Routes, handler: (changed: PerceptionChanged) => void): () => void {
  state.push.perception.add(handler);
  return () => state.push.perception.delete(handler);
}

export function addExtensionChangedHandler(state: Routes, handler: (changed: ExtensionChanged) => void): () => void {
  state.push.extension.add(handler);
  return () => state.push.extension.delete(handler);
}

export function addApprovalHandler(state: Routes, handler: (event: ApprovalPushEvent) => void): () => void {
  state.push.approval.add(handler);
  return () => state.push.approval.delete(handler);
}
export function addMonitorHandler(state: Routes, handler: (event: RunMonitorEvent) => void): () => void { state.push.monitor.add(handler); return () => state.push.monitor.delete(handler); }
export function addMemoryOperationHandler(state: Routes, handler: (operation: MemoryOperation) => void): () => void {
  state.push.memoryOperation.add(handler);
  return () => state.push.memoryOperation.delete(handler);
}

function notifyMonitorHandlers(state: Routes, event: RunMonitorEvent): void {
  for (const handler of [...state.push.monitor]) {
    try { handler(event); } catch { console.warn("[ws-client] monitor handler failed"); }
  }
}

/** Retires every connection-scoped push sink before queued notifications can dispatch on a closed transport. */
function clearPushHandlers(state: Routes): void {
  state.push.subagentActivity.clear();
  state.push.subagents.clear();
  state.push.coWatching.clear();
  state.push.initiativePatterns.clear();
  state.push.initiativeSetup.clear();
  state.push.initiativePolicy.clear();
  state.push.initiativeBackoff.clear();
  state.push.avatar = null;
  state.push.timeline = null;
  state.push.timelineRemoved = null;
  state.push.config.clear();
  state.push.perception.clear();
  state.push.extension.clear();
  state.push.approval.clear();
  state.push.monitor.clear();
  state.push.activity.clear();
  state.push.committed.clear();
  state.push.memoryOperation.clear();
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
  installFanOutRoutes(rpc, state);
  installApprovalRoutes(rpc, state);
  installInitiativeRoutes(rpc, state);
}

function installInitiativeRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(INITIATIVE_BACKOFF_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.initiativeBackoff, InitiativeBackoffChangedSchema.parse(params));
  });
  for (const [method, kind] of [
    [INTERACTION_PATTERN_METHODS.changed, "initiativePatterns"],
    [INITIATIVE_SETUP_METHODS.changed, "initiativeSetup"],
    [INITIATIVE_WAKE_METHODS.changed, "initiativePolicy"],
  ] as const) {
    rpc.addMethod(method, (params: unknown) => {
      publishHandlers(state.push[kind], InteractionPatternChangedSchema.parse(params));
    });
  }
}

/** Multi-handler pushes: one throwing handler never starves its siblings. */
function installFanOutRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
  rpc.addMethod(SUBAGENT_METHODS.activity, (params: unknown) => {
    publishHandlers(state.push.subagentActivity, SubagentActivitySchema.parse(params));
  });
  rpc.addMethod(SUBAGENT_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.subagents, SubagentChangedSchema.parse(params));
  });
  rpc.addMethod(CO_WATCHING_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.coWatching, CoWatchingChangedSchema.parse(params));
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
  rpc.addMethod(PERCEPTION_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.perception, PerceptionChangedSchema.parse(params));
  });
  rpc.addMethod(EXTENSION_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.extension, ExtensionChangedSchema.parse(params));
  });
  installApprovalRoutes(rpc, state);
  rpc.addMethod(MEMORY_OPERATION_METHODS.changed, (params: unknown) => {
    publishHandlers(state.push.memoryOperation, MemoryOperationChangedSchema.parse(params).operation);
  });
}

function publishHandlers<T>(handlers: Set<(value: T) => void>, value: T): void {
  for (const handler of [...handlers]) {
    try { handler(value); } catch { console.warn("[ws-client] push handler failed"); }
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
