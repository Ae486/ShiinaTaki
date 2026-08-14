/**
 * INPUT:  a WS URL; inbound JSON-RPC frames (acks, chat stream, canonical Approval request/closed pushes)
 * OUTPUT: connectChatClient(url) -> ChatClient with chat/read/call plus targeted Approval response/event methods
 * POS:    cli — the transport client; @taki/shared-typed, zod-validates inbound frames; never imports @taki/core
 */
import { once } from "node:events";
import { JSONRPCClient, JSONRPCErrorException, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { WebSocket } from "ws";
import {
  APPROVAL_METHODS,
  CHAT_METHODS,
  CONNECT_METHOD,
  ApprovalClosedSchema,
  CanonicalApprovalRequestSchema,
  CanonicalApprovalRespondResultSchema,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ConnectResultSchema,
  ErrorCodeSchema,
  JsonRpcClientFrameSchema,
  TIMELINE_METHODS,
  TimelineHistoryResultSchema,
  type ApprovalClosed,
  type CanonicalApprovalRequest,
  type CanonicalApprovalRespondParams,
  type CanonicalApprovalRespondResult,
  type ChatSendParams,
  type ConnectParams,
  type ErrorCode,
  type JsonRpcClientFrame,
  type TimelineHistoryParams,
  type TimelineHistoryResult,
} from "@taki/shared";

export interface ChatHandlers {
  onDelta: (delta: string) => void;
  onComplete?: () => void;
  onError?: (code: ErrorCode, message: string) => void;
}

/** The operator's answer to an MCP tool-approval ask (mirrors approval-prompt's ApprovalAnswer). */
export type ApprovalPushEvent =
  | { type: "request"; request: CanonicalApprovalRequest }
  | { type: "closed"; closed: ApprovalClosed };

/** The connect handshake outcome: authenticated (ok, token present only right after pairing) or refused. */
export type ConnectOutcome =
  | { ok: true; token?: string }
  | { ok: false; code: ErrorCode | null; message: string };

export interface ChatClient {
  /** Runs the pre-auth handshake; must resolve `ok` before chat() is usable. */
  connect(params: ConnectParams): Promise<ConnectOutcome>;
  /** Sends one message and resolves when the turn ends (complete or error). */
  chat(params: ChatSendParams, handlers: ChatHandlers): Promise<void>;
  /** Fetches one newest-first page of the conversation timeline. */
  history(params: TimelineHistoryParams): Promise<TimelineHistoryResult>;
  /** Invokes any server method by name (operator tooling); the server registry gates roles and validates params. */
  call(method: string, params: unknown): Promise<unknown>;
  /** Sends one canonical Approval response; the caller owns explicit disclosure UX. */
  approvalRespond(params: CanonicalApprovalRespondParams): Promise<CanonicalApprovalRespondResult>;
  /** Registers the socket-targeted Approval request/closed stream. */
  onApproval(handler: (event: ApprovalPushEvent) => void): () => void;
  /** Registers a close callback; consumers guard it against retired generations. */
  onClose(handler: () => void): void;
  close(): void;
}

interface Turn {
  handlers: ChatHandlers;
  finish: () => void;
}

interface TurnState {
  current: Turn | null;
}

/** Routes the server's chat notifications to the in-flight turn; each is zod-validated. */
function installChatRoutes(rpc: JSONRPCServerAndClient, state: TurnState): void {
  const endTurn = (act: (turn: Turn) => void): void => {
    const turn = state.current;
    state.current = null;
    if (turn) act(turn);
  };
  rpc.addMethod(CHAT_METHODS.delta, (params: unknown) => {
    state.current?.handlers.onDelta(ChatDeltaSchema.parse(params).delta);
  });
  rpc.addMethod(CHAT_METHODS.complete, (params: unknown) => {
    ChatCompleteSchema.parse(params);
    endTurn((turn) => {
      turn.handlers.onComplete?.();
      turn.finish();
    });
  });
  rpc.addMethod(CHAT_METHODS.error, (params: unknown) => {
    const { code, message } = ChatErrorSchema.parse(params);
    endTurn((turn) => {
      turn.handlers.onError?.(code, message);
      turn.finish();
    });
  });
}

interface ApprovalSlot {
  handlers: Set<(event: ApprovalPushEvent) => void>;
}

function installApprovalRoute(rpc: JSONRPCServerAndClient, slot: ApprovalSlot): void {
  rpc.addMethod(APPROVAL_METHODS.request, (params: unknown) => {
    const request = CanonicalApprovalRequestSchema.parse(params);
    notifyApprovalHandlers(slot, { type: "request", request });
  });
  rpc.addMethod(APPROVAL_METHODS.closed, (params: unknown) => {
    const closed = ApprovalClosedSchema.parse(params);
    notifyApprovalHandlers(slot, { type: "closed", closed });
  });
}

function notifyApprovalHandlers(slot: ApprovalSlot, event: ApprovalPushEvent): void {
  for (const handler of [...slot.handlers]) {
    try {
      handler(event);
    } catch {
      process.stderr.write("[approval] ignored a failed local handler\n");
    }
  }
}

/** null = not a valid client frame; the caller surfaces it (never a silent swallow). */
function parseClientFrame(text: string): JsonRpcClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const frame = JsonRpcClientFrameSchema.safeParse(parsed);
  return frame.success ? frame.data : null;
}

// The json-rpc-2.0 client rejects with a JSONRPCErrorException carrying error.code + error.data,
// so the app-level ErrorCode (PAIRING_REQUIRED / AUTH_FAILED / ...) survives to the caller.
async function handshake(rpc: JSONRPCServerAndClient, params: ConnectParams): Promise<ConnectOutcome> {
  try {
    const result = ConnectResultSchema.parse(await rpc.request(CONNECT_METHOD, params));
    return { ok: true, token: result.token };
  } catch (error) {
    if (error instanceof JSONRPCErrorException) {
      return { ok: false, code: appErrorCode(error.data), message: error.message };
    }
    throw error;
  }
}

function appErrorCode(data: unknown): ErrorCode | null {
  if (typeof data !== "object" || data === null || !("code" in data)) return null;
  const parsed = ErrorCodeSchema.safeParse((data as { code: unknown }).code);
  return parsed.success ? parsed.data : null;
}

export async function connectChatClient(url: string): Promise<ChatClient> {
  const ws = new WebSocket(url);
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => ws.send(JSON.stringify(payload))),
  );

  const state: TurnState = { current: null };
  installChatRoutes(rpc, state);
  const approvalSlot: ApprovalSlot = { handlers: new Set() };
  installApprovalRoute(rpc, approvalSlot);
  const closeHandlers = new Set<() => void>();

  ws.on("message", (data) => {
    const frame = parseClientFrame(data.toString());
    if (frame === null) {
      process.stderr.write("[protocol] dropped an invalid frame from the server\n");
      return;
    }
    void rpc.receiveAndSend(frame);
  });
  ws.on("close", () => {
    rpc.rejectAllPendingRequests("connection closed");
    for (const handler of [...closeHandlers]) handler();
  });

  await once(ws, "open");

  return {
    connect: (params) => handshake(rpc, params),
    async chat(params, handlers) {
      const done = new Promise<void>((resolve) => {
        state.current = { handlers, finish: resolve };
      });
      try {
        await rpc.request(CHAT_METHODS.send, params);
      } catch (error) {
        state.current = null; // the turn never started — drop the stale handlers
        throw error;
      }
      await done;
    },
    history: async (params) => TimelineHistoryResultSchema.parse(await rpc.request(TIMELINE_METHODS.history, params)),
    // Deliberately unvalidated and unfiltered: the generic operator surface forwards the raw result so a new
    // server method works here the day it ships (the caller decides what to do with the shape).
    call: async (method, params) => rpc.request(method, params),
    approvalRespond: async (params) => CanonicalApprovalRespondResultSchema.parse(await rpc.request(APPROVAL_METHODS.respond, params)),
    onApproval: (handler) => {
      approvalSlot.handlers.add(handler);
      return () => approvalSlot.handlers.delete(handler);
    },
    onClose: (handler) => { closeHandlers.add(handler); },
    close: () => ws.close(),
  };
}
