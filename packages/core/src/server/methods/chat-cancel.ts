/**
 * INPUT:  ChatCancelParams from a dispatched chat.cancel request + the TurnRegistry
 * OUTPUT: chatCancelMethod(turns) -> MethodDefinition (operator-only); aborts the character's in-flight turn
 * POS:    core/server/methods — one file per WS method; cancellation is idempotent ({cancelled:false} when idle)
 */
import {
  CHAT_METHODS,
  ChatCancelParamsSchema,
  type ChatCancelParams,
  type ChatCancelResult,
} from "@taki/shared";
import type { TurnRegistry } from "../../agents/turn-registry.ts";
import type { RunService } from "../../harness/run-service.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function chatCancelMethod(
  turns: TurnRegistry,
  runs?: Pick<RunService, "requestCancel" | "status">,
): MethodDefinition<ChatCancelParams> {
  return {
    method: CHAT_METHODS.cancel,
    roles: ["operator"], // the conversation is an operator concern, and so is stopping it
    paramsSchema: ChatCancelParamsSchema,
    handler: (params): ChatCancelResult => {
      const exact = params.runId === undefined ? undefined : readExactRun(runs, params.runId);
      const durable = exact?.characterId === params.characterId
        && runs?.requestCancel(exact.runId, "operator cancel") === true;
      const active = turns.cancel(params.characterId, params.runId);
      return { cancelled: durable || active };
    },
  };
}

function readExactRun(
  runs: Pick<RunService, "status"> | undefined,
  runId: string,
): ReturnType<RunService["status"]>["run"] | undefined {
  if (!runs) return undefined;
  try {
    return runs.status(runId).run;
  } catch (error) {
    if (error instanceof Error && error.message === "RUN_NOT_FOUND") return undefined;
    throw error;
  }
}
