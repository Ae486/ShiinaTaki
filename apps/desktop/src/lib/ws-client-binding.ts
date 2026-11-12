/**
 * INPUT: transport lifecycle events, inbound JSON-RPC frames and connection-scoped route state
 * OUTPUT: bounded socket-open waiting, validated frame dispatch and complete close/retire settlement
 * POS: ui/lib — connection lifetime owner; no React/Tauri imports or runtime route-owner dependency
 */
import type { JSONRPCServerAndClient } from "json-rpc-2.0";
import { JsonRpcClientFrameSchema, type JsonRpcClientFrame } from "@taki/shared";
import type { WsTransport } from "./ws-transport.ts";
import type { Routes } from "./ws-client-routes.ts";
import { abortPendingChatTurn } from "./ws-chat-turn.ts";

/** Retires every connection-scoped push sink before queued notifications can dispatch on a closed transport. */
function clearPushHandlers(state: Routes): void {
  state.push.modelProfiles.clear();
  state.push.cacheUsage.clear();
  state.push.maintenanceMonitor.clear();
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
  state.push.memoryOperation.clear();
  state.push.memoryReplica.clear();
  state.push.memoryOnboarding.clear();
  state.push.activity.clear();
  state.push.committed.clear();
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
