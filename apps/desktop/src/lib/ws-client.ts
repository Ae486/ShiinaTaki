/**
 * INPUT:  a WsTransport (browser WebSocket by default) + inbound JSON-RPC frames from the Core; every frame is zod-parsed here.
 * OUTPUT: createWsClient({transport}) -> WsClient: connect()/chat()/subscribeAvatar()/reportAvatar() + avatar/timeline push handlers.
 * POS:    ui/lib — the Pet UI's operator transport to the Agent Core (mirrors apps/cli chat-client, browser WS). THE
 *         zod boundary: past this file inbound data is trusted typed data (type-safety spec). No React/Tauri imports.
 */

import { JSONRPCClient, JSONRPCErrorException, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import {
  AVATAR_METHODS,
  AvatarCommandSchema,
  CHAT_METHODS,
  CONNECT_METHOD,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ConnectResultSchema,
  ErrorCodeSchema,
  JsonRpcClientFrameSchema,
  TIMELINE_METHODS,
  TimelineAppendedSchema,
  type AvatarCommand,
  type AvatarReportParams,
  type ChatSendParams,
  type ConnectParams,
  type ErrorCode,
  type JsonRpcClientFrame,
  type TimelineEntry,
} from "@taki/shared";
import type { WsTransport } from "./ws-transport.ts";

/** Streamed-turn callbacks: deltas append into the bubble, complete/error settle it (mirrors the CLI's ChatHandlers). */
export interface ChatHandlers {
  onDelta: (delta: string) => void;
  onComplete?: () => void;
  onError?: (code: ErrorCode, message: string) => void;
}

/** The handshake outcome: authenticated, or refused with the app ErrorCode (PAIRING_REQUIRED / AUTH_FAILED / ...). */
export type ConnectOutcome =
  | { ok: true; token?: string }
  | { ok: false; code: ErrorCode | null; message: string };

export interface WsClient {
  connect(params: ConnectParams): Promise<ConnectOutcome>;
  chat(params: ChatSendParams, handlers: ChatHandlers): Promise<void>;
  subscribeAvatar(characterId: string): Promise<void>;
  reportAvatar(params: AvatarReportParams): Promise<void>;
  /** Registers the fire-and-forget avatar command sink (core -> operator push). Replaces any prior handler. */
  onAvatarCommand(handler: (command: AvatarCommand) => void): void;
  /** Registers the optional live-timeline sink (shared with the chat window server-side). */
  onTimelineAppended(handler: (entry: TimelineEntry) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

interface Turn {
  handlers: ChatHandlers;
  finish: () => void;
}

interface PushSlots {
  avatar: ((command: AvatarCommand) => void) | null;
  timeline: ((entry: TimelineEntry) => void) | null;
}

interface Routes {
  current: Turn | null;
  push: PushSlots;
}

/** Routes the Core's notifications (chat stream + avatar/timeline pushes) to their handlers; each is zod-validated. */
function installRoutes(rpc: JSONRPCServerAndClient, state: Routes): void {
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
  // Fire-and-forget pushes: a missing handler is harmless (closing the Pet UI must not break a turn, invariant 4).
  rpc.addMethod(AVATAR_METHODS.command, (params: unknown) => {
    state.push.avatar?.(AvatarCommandSchema.parse(params));
  });
  rpc.addMethod(TIMELINE_METHODS.appended, (params: unknown) => {
    state.push.timeline?.(TimelineAppendedSchema.parse(params));
  });
}

/** null = not a valid client frame; the caller drops it (never a silent swallow that corrupts routing). */
function parseFrame(text: string): JsonRpcClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const frame = JsonRpcClientFrameSchema.safeParse(parsed);
  return frame.success ? frame.data : null;
}

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
  const parsed = ErrorCodeSchema.safeParse(data.code);
  return parsed.success ? parsed.data : null;
}

export function createWsClient(deps: { transport: WsTransport }): WsClient {
  const { transport } = deps;
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => transport.send(JSON.stringify(payload))),
  );
  const state: Routes = { current: null, push: { avatar: null, timeline: null } };
  installRoutes(rpc, state);

  let opened = false;
  const openWaiters: Array<() => void> = [];
  transport.onOpen(() => {
    opened = true;
    for (const wake of openWaiters.splice(0)) wake();
  });
  transport.onMessage((data) => {
    const frame = parseFrame(data);
    if (frame) void rpc.receiveAndSend(frame);
  });
  transport.onClose(() => rpc.rejectAllPendingRequests("connection closed"));
  const whenOpen = (): Promise<void> =>
    opened ? Promise.resolve() : new Promise<void>((resolve) => openWaiters.push(resolve));

  return {
    async connect(params) {
      await whenOpen();
      return handshake(rpc, params);
    },
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
    async subscribeAvatar(characterId) {
      await rpc.request(AVATAR_METHODS.subscribe, { characterId });
    },
    async reportAvatar(params) {
      await rpc.request(AVATAR_METHODS.report, params);
    },
    onAvatarCommand: (handler) => (state.push.avatar = handler),
    onTimelineAppended: (handler) => (state.push.timeline = handler),
    onClose: (handler) => transport.onClose(handler),
    close: () => transport.close(),
  };
}
