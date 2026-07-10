/**
 * INPUT:  ChatSendParams from a dispatched chat.send request + a ChatAgent
 * OUTPUT: MethodDefinition (operator-only); acks { messageId }, then streams chat.delta/.complete/.error via ctx
 * POS:    core/server/methods — one file per WS method; the boundary that turns provider failures into structured errors
 */
import { randomUUID } from "node:crypto";
import { APICallError } from "ai";
import {
  CHAT_METHODS,
  ChatSendParamsSchema,
  ErrorCodeSchema,
  type ChatComplete,
  type ChatDelta,
  type ChatError,
  type ChatSendParams,
  type ChatSendResult,
} from "@taki/shared";
import type { ChatAgent } from "../../agents/chat-agent.ts";
import type { Logger } from "../../logging/logger.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";

export function chatSendMethod(chatAgent: ChatAgent, logger: Logger): MethodDefinition<ChatSendParams> {
  const log = logger.child({ mod: "chat-send" });
  return {
    method: CHAT_METHODS.send,
    roles: ["operator"], // conversing is an operator concern; nodes are capability providers (prd §3)
    paramsSchema: ChatSendParamsSchema,
    handler: (params, ctx): ChatSendResult => {
      const messageId = randomUUID();
      // Defer streaming to the next macrotask so the ack — sent by the server as
      // this dispatch's result, a couple of microtask hops later — is flushed to
      // the socket before the first delta notification.
      setImmediate(() => void pump({ chatAgent, log, params, ctx, messageId }));
      return { messageId };
    },
  };
}

interface PumpArgs {
  chatAgent: ChatAgent;
  log: Logger;
  params: ChatSendParams;
  ctx: MethodContext;
  messageId: string;
}

async function pump({ chatAgent, log, params, ctx, messageId }: PumpArgs): Promise<void> {
  const { characterId } = params;
  try {
    // The turn handle lets MCP tool approvals ride ctx.notify (approval.request) and deny-on-disconnect via ctx.onClose.
    for await (const delta of chatAgent.stream(params, { notify: ctx.notify, onClose: ctx.onClose })) {
      ctx.notify(CHAT_METHODS.delta, { messageId, characterId, delta } satisfies ChatDelta);
    }
    ctx.notify(CHAT_METHODS.complete, { messageId, characterId } satisfies ChatComplete);
  } catch (error) {
    const message = readableError(error);
    log.warn({ messageId, characterId, err: message }, "chat stream failed");
    ctx.notify(CHAT_METHODS.error, {
      messageId,
      characterId,
      code: ErrorCodeSchema.enum.PROVIDER_ERROR,
      message,
    } satisfies ChatError);
  }
}

/** One-line human/LLM-readable failure message; never includes the prompt or key. */
function readableError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode === undefined ? "" : ` (HTTP ${error.statusCode})`;
    return `Provider request failed${status}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
