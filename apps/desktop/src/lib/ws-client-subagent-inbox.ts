/**
 * INPUT: deadline-bound operator requests and Shared attention/reconciliation contracts
 * OUTPUT: bounded parsed attention, recovery inspection and exact operator-authorized recovery requests
 * POS: ui/lib — no automatic replay, retry loop or execution authority
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import { SUBAGENT_METHODS, SubagentInboxRecoveryResultSchema, SubagentInboxResumeResultSchema,
  SubagentAttentionResultSchema, type SubagentAttentionParams, SubagentInboxRetryResultSchema, type SubagentInboxRetryParams,
  type SubagentInboxRecoveryParams, type SubagentInboxResumeParams } from "@taki/shared";

export function subagentInboxMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    subagentAttention: async (params: SubagentAttentionParams) =>
      SubagentAttentionResultSchema.parse(await request(SUBAGENT_METHODS.attention, params)),
    subagentInboxRetry: async (params: SubagentInboxRetryParams) =>
      SubagentInboxRetryResultSchema.parse(await request(SUBAGENT_METHODS.inboxRetry, params)),
    subagentInboxRecovery: async (params: SubagentInboxRecoveryParams) =>
      SubagentInboxRecoveryResultSchema.parse(await request(SUBAGENT_METHODS.inboxRecovery, params)),
    subagentInboxResume: async (params: SubagentInboxResumeParams) =>
      SubagentInboxResumeResultSchema.parse(await request(SUBAGENT_METHODS.inboxResume, params)),
  };
}
