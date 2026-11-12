/**
 * INPUT:  an operator's Character-scoped chat.activity.read request
 * OUTPUT: one complete disposable snapshot, idle, or explicit capacity-unavailable state
 * POS:    core/server/methods — read-only restoration; never admission, resend, or tool execution
 */
import { CHAT_METHODS, ChatActivityReadParamsSchema, type ChatActivityReadParams } from "@taki/shared";
import type { ChatActivityProjection } from "../../agents/chat-activity-projection.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function chatActivityReadMethod(activity: ChatActivityProjection): MethodDefinition<ChatActivityReadParams> {
  return {
    method: CHAT_METHODS.activityRead,
    roles: ["operator"],
    paramsSchema: ChatActivityReadParamsSchema,
    handler: ({ characterId }) => activity.read(characterId),
  };
}
