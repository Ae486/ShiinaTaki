/**
 * INPUT:  ChatSendParams from a dispatched chat.send request + a ChatAgent + TurnControls (queue + registry)
 * OUTPUT: MethodDefinition (operator-only); acks { messageId }, then streams chat.delta/.complete/.error via ctx;
 *         turns are serialized per characterId and cancellable (chat.cancel / connection close); a cancel-before-reply
 *         closes with chat.error { retracted: true } (draft restore) instead of complete
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
import type { TurnQueue } from "../../agents/turn-queue.ts";
import type { TurnRegistry } from "../../agents/turn-registry.ts";
import type { Logger } from "../../logging/logger.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";

/** The turn-lifecycle pair every send runs under: per-character serialization + cancellation (D1 #3/#4). */
export interface TurnControls {
  queue: TurnQueue;
  turns: TurnRegistry;
}

export function chatSendMethod(
  chatAgent: ChatAgent,
  logger: Logger,
  controls: TurnControls,
): MethodDefinition<ChatSendParams> {
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
      setImmediate(() => void runQueued({ chatAgent, log, params, ctx, messageId, controls }));
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
  controls: TurnControls;
}

// A turn fully commits (append user -> stream -> append turn) before the character's next send starts; concurrent
// sends for one character would otherwise interleave appends and read each other's half-written history (D1 #3).
async function runQueued(args: PumpArgs): Promise<void> {
  const { controls, params } = args;
  const release = await controls.queue.acquire(params.characterId);
  const controller = controls.turns.begin(params.characterId);
  try {
    await pump(args, controller);
  } finally {
    controls.turns.end(params.characterId, controller);
    release();
  }
}

async function pump(args: PumpArgs, controller: AbortController): Promise<void> {
  const { chatAgent, log, params, ctx, messageId } = args;
  const { characterId } = params;
  // A closing operator socket aborts its own in-flight turn — nobody is listening to the deltas anymore.
  // The controller is per-turn, so a late close event can never abort a later turn.
  ctx.onClose(() => controller.abort("connection closed"));
  // Set by the agent's retract seam when a cancel landed before any reply: the user row was already deleted
  // (timeline.removed pushed), so this turn closes with a retract error instead of a normal complete.
  let retracted = false;
  try {
    // The turn handle lets MCP tool approvals ride ctx.notify (approval.request) and deny-on-disconnect via ctx.onClose.
    const turn = {
      connection: ctx.connection,
      notify: ctx.notify,
      onClose: ctx.onClose,
      signal: controller.signal,
      onRetract: () => (retracted = true),
    };
    for await (const delta of chatAgent.stream(params, turn)) {
      ctx.notify(CHAT_METHODS.delta, { messageId, characterId, delta } satisfies ChatDelta);
    }
    if (retracted) {
      // Cancelled before any reply: BOTH cancel endings land here, not the catch — a graceful abort closes the
      // stream cleanly, and the agent swallows the throw ending once it retracts. Tell the UI to restore the draft.
      ctx.notify(CHAT_METHODS.error, {
        messageId,
        characterId,
        code: ErrorCodeSchema.enum.PROVIDER_ERROR,
        message: "cancelled before reply; message retracted",
        retracted: true,
      } satisfies ChatError);
    } else {
      // A cancelled-after-output turn also ends here: the stream closes gracefully after the abort, partial text streamed.
      ctx.notify(CHAT_METHODS.complete, { messageId, characterId } satisfies ChatComplete);
    }
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
