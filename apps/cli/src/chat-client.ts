/**
 * INPUT:  a WS URL; inbound JSON-RPC frames (ack + chat.* notifications)
 * OUTPUT: connectChatClient(url) -> ChatClient: connect()/chat()/history()/call()/close over one WS
 * POS:    cli — the transport client; @taki/shared-typed, zod-validates inbound frames; never imports @taki/core
 */
import { once } from "node:events";
import { JSONRPCClient, JSONRPCErrorException, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { WebSocket } from "ws";
import {
  APPROVAL_METHODS,
  CHAT_METHODS,
  CONNECT_METHOD,
  ApprovalRequestSchema,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ConnectResultSchema,
  ErrorCodeSchema,
  JsonRpcClientFrameSchema,
  TIMELINE_METHODS,
  TimelineHistoryResultSchema,
  type ApprovalRequest,
  type ApprovalScope,
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
export type ApprovalDecision = { approved: boolean; scope: ApprovalScope };
export type ApprovalRequestHandler = (request: ApprovalRequest) => Promise<ApprovalDecision>;

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
  /** Registers the handler asked to approve/deny each MCP tool call the agent proposes mid-turn. */
  onApprovalRequest(handler: ApprovalRequestHandler): void;
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

/** A mutable slot for the approval handler so the route can be registered once at construction, set later. */
interface ApprovalSlot {
  handler: ApprovalRequestHandler | null;
}

// approval.request arrives as a server notification mid-turn; answer with a normal approval.respond request
// (operator role). No handler registered -> fail-closed deny-once, so the agent's turn never hangs.
function installApprovalRoute(rpc: JSONRPCServerAndClient, slot: ApprovalSlot): void {
  rpc.addMethod(APPROVAL_METHODS.request, async (params: unknown) => {
    const request = ApprovalRequestSchema.parse(params);
    const decision: ApprovalDecision = slot.handler
      ? await slot.handler(request)
      : { approved: false, scope: "once" };
    await rpc.request(APPROVAL_METHODS.respond, {
      approvalId: request.approvalId,
      approved: decision.approved,
      scope: decision.scope,
    });
  });
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
  const approvalSlot: ApprovalSlot = { handler: null };
  installApprovalRoute(rpc, approvalSlot);

  ws.on("message", (data) => {
    const frame = parseClientFrame(data.toString());
    if (frame === null) {
      process.stderr.write("[protocol] dropped an invalid frame from the server\n");
      return;
    }
    void rpc.receiveAndSend(frame);
  });
  ws.on("close", () => rpc.rejectAllPendingRequests("connection closed"));

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
    onApprovalRequest: (handler) => {
      approvalSlot.handler = handler;
    },
    close: () => ws.close(),
  };
}
