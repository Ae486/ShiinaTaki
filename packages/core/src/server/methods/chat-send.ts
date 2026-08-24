/**
 * INPUT:  ChatSendParams from a dispatched chat.send request + a ChatAgent + TurnControls (queue + registry)
 * OUTPUT: MethodDefinition (operator-only); durably admits then acks { messageId, runId }, then streams notifications;
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
  TriggerRequestSchema,
} from "@taki/shared";
import type { ChatAgent } from "../../agents/chat-agent.ts";
import type { RunService } from "../../harness/run-service.ts";
import type { TurnInteractive } from "../../mcp/mcp-turn-tools.ts";
import type { TurnQueue } from "../../agents/turn-queue.ts";
import type { TurnRegistry } from "../../agents/turn-registry.ts";
import type { Logger } from "../../logging/logger.ts";
import type { MethodContext, MethodDefinition } from "../method-registry.ts";

/** The turn-lifecycle pair every send runs under: per-character serialization + cancellation (D1 #3/#4). */
export interface TurnControls {
  queue: TurnQueue;
  turns: TurnRegistry;
}

// eslint-disable-next-line max-params
export function chatSendMethod(
  chatAgent: ChatAgent,
  logger: Logger,
  controls: TurnControls,
  runs: RunService<TurnInteractive>,
): MethodDefinition<ChatSendParams> {
  const log = logger.child({ mod: "chat-send" });
  return {
    method: CHAT_METHODS.send,
    roles: ["operator"], // conversing is an operator concern; nodes are capability providers (prd §3)
    paramsSchema: ChatSendParamsSchema,
    handler: async (params, ctx): Promise<ChatSendResult> => {
      const messageId = randomUUID();
      const controller = new AbortController();
      const runIdRef: { value?: string } = {};
      let closed = false;
      ctx.onClose(() => {
        closed = true;
        if (!controller.signal.aborted) controller.abort("connection closed");
        if (runIdRef.value) runs.requestCancel(runIdRef.value, "connection closed");
      });
      const request = TriggerRequestSchema.parse({
        triggerRequestId: randomUUID(), idempotencyKey: messageId, characterId: params.characterId,
        initiator: "primary", provenance: { provider: "chat", triggerRequestId: messageId },
        deliveryClass: "class_a", contextMode: "primary",
      });
      const admitted = await runs.admit(request, { connection: ctx.connection, signal: controller.signal });
      const runId = admitted.run.runId;
      const attemptId = admitted.attempt.attemptId;
      runIdRef.value = runId;
      if (closed) runs.requestCancel(runId, "connection closed");
      // Defer streaming to the next macrotask so the ack — sent by the server as
      // this dispatch's result, a couple of microtask hops later — is flushed to
      // the socket before the first delta notification.
      setImmediate(() => void runQueued({ chatAgent, log, params, ctx, messageId, runId, attemptId, controller, controls, runs }));
      return { messageId, runId };
    },
  };
}

interface PumpArgs {
  chatAgent: ChatAgent;
  log: Logger;
  params: ChatSendParams;
  ctx: MethodContext;
  messageId: string;
  runId: string;
  attemptId: string;
  controller: AbortController;
  controls: TurnControls;
  runs: RunService<TurnInteractive>;
}

// A turn fully commits (append user -> stream -> append turn) before the character's next send starts; concurrent
// sends for one character would otherwise interleave appends and read each other's half-written history (D1 #3).
async function runQueued(args: PumpArgs): Promise<void> {
  const { controls, params } = args;
  const release = await controls.queue.acquire(params.characterId);
  const controller = controls.turns.begin(params.characterId, args.controller, args.runId);
  try {
    if (args.runs.start(args.runId, args.attemptId) === false) return;
    await pump(args, controller);
  } finally {
    controls.turns.end(params.characterId, controller);
    release();
  }
}

// eslint-disable-next-line max-lines-per-function
async function pump(args: PumpArgs, controller: AbortController): Promise<void> {
  const { chatAgent, log, params, ctx, messageId, runId, runs } = args;
  let attemptId = args.attemptId;
  const { characterId } = params;
  // A closing operator socket aborts its own in-flight turn — nobody is listening to the deltas anymore.
  // The controller is per-turn, so a late close event can never abort a later turn.
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
    for await (const delta of chatAgent.stream(params, {
      ...turn,
      runId,
      turnKind: "primary",
      runContext: runs.context(runId),
      onRetry: (reason) => {
        const before = runs.status(runId).run;
        if (before.state !== "running" || before.activeAttemptId !== attemptId) return false;
        const next = runs.retry(runId, attemptId, reason);
        const nextAttemptId = next.run.activeAttemptId;
        if (next.run.state !== "running" || !nextAttemptId || nextAttemptId === attemptId) return false;
        attemptId = nextAttemptId;
        return true;
      },
    })) {
      ctx.notify(CHAT_METHODS.delta, { messageId, characterId, delta } satisfies ChatDelta);
    }
    if (retracted) {
      runs.requestCancel(runId, "turn cancelled before reply");
      runs.settle(runId, attemptId, "cancelled", { retryable: false, summary: "cancelled before reply" });
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
      if (controller.signal.aborted) runs.requestCancel(runId, "turn cancelled");
      runs.settle(runId, attemptId, controller.signal.aborted ? "cancelled" : "completed", { retryable: false });
      // A cancelled-after-output turn also ends here: the stream closes gracefully after the abort, partial text streamed.
      ctx.notify(CHAT_METHODS.complete, { messageId, characterId } satisfies ChatComplete);
    }
  } catch (error) {
    const evidence = runFailureEvidence(error);
    if (controller.signal.aborted) runs.requestCancel(runId, "turn cancelled");
    runs.settle(runId, attemptId, controller.signal.aborted ? "cancelled" : "failed", {
      retryable: evidence.retryable,
      summary: controller.signal.aborted ? "turn cancelled" : evidence.summary,
      errorCode: evidence.errorCode,
    });
    // Provider messages and arbitrary thrown values can contain request bodies, prompts, tool payloads, or credentials.
    // Keep those out of durable Receipt evidence and Pino; the interactive error remains user-facing only.
    log.warn({ messageId, characterId, errorCode: evidence.errorCode }, "chat stream failed");
    ctx.notify(CHAT_METHODS.error, {
      messageId,
      characterId,
      code: ErrorCodeSchema.enum.PROVIDER_ERROR,
      message: controller.signal.aborted ? "turn cancelled" : evidence.summary,
    } satisfies ChatError);
  }
}


function runFailureEvidence(error: unknown): { retryable: boolean; summary: string; errorCode: string } {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode === undefined ? "" : ` (HTTP ${error.statusCode})`;
    return {
      retryable: error.isRetryable,
      summary: `Provider request failed${status}`,
      errorCode: String(error.statusCode ?? "provider"),
    };
  }
  return { retryable: false, summary: "Agent turn failed", errorCode: "agent_error" };
}
