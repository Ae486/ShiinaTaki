/**
 * INPUT:  a WS URL; inbound JSON-RPC frames (ack + chat.* notifications)
 * OUTPUT: connectChatClient(url) -> ChatClient.chat(params, handlers) resolving on complete/error
 * POS:    cli — the transport client; @taki/shared-typed, zod-validates inbound frames; never imports @taki/core
 */
import { once } from "node:events";
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { WebSocket } from "ws";
import {
  CHAT_METHODS,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  JsonRpcClientFrameSchema,
  type ChatSendParams,
  type ErrorCode,
  type JsonRpcClientFrame,
} from "@taki/shared";

export interface ChatHandlers {
  onDelta: (delta: string) => void;
  onComplete?: () => void;
  onError?: (code: ErrorCode, message: string) => void;
}

export interface ChatClient {
  /** Sends one message and resolves when the turn ends (complete or error). */
  chat(params: ChatSendParams, handlers: ChatHandlers): Promise<void>;
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

export async function connectChatClient(url: string): Promise<ChatClient> {
  const ws = new WebSocket(url);
  const rpc = new JSONRPCServerAndClient(
    new JSONRPCServer(),
    new JSONRPCClient((payload) => ws.send(JSON.stringify(payload))),
  );

  const state: TurnState = { current: null };
  installChatRoutes(rpc, state);

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
    close: () => ws.close(),
  };
}
