import type { SubagentConversationEntry, SubagentConversationResult } from "@taki/shared";
import { CHILD_A, WORK_A, history } from "./s7-subagent-data.ts";

export function conversation(subagentId = CHILD_A): SubagentConversationResult {
  const source = history(subagentId);
  const entries: SubagentConversationEntry[] = [
    ...source.inputs.map((input) => ({ kind: "input" as const, input, createdAt: input.createdAt,
      historicalOrder: false, subagentId, workInputId: input.workInputId, seq: input.inputSeq })),
    ...source.messages.map((message) => ({ kind: "message" as const, message, createdAt: message.createdAt,
      historicalOrder: false, subagentId, workInputId: WORK_A, seq: message.seq + 2 })),
  ];
  return { conversation: source.conversation, entries, nextCursor: null, hasMore: false };
}
