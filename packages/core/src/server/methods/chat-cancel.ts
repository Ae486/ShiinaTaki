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
import type { MethodDefinition } from "../method-registry.ts";

export function chatCancelMethod(turns: TurnRegistry): MethodDefinition<ChatCancelParams> {
  return {
    method: CHAT_METHODS.cancel,
    roles: ["operator"], // the conversation is an operator concern, and so is stopping it
    paramsSchema: ChatCancelParamsSchema,
    handler: (params): ChatCancelResult => ({ cancelled: turns.cancel(params.characterId) }),
  };
}
