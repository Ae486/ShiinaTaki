/**
 * INPUT: deadline-bound operator requests and Shared explicit inbox reconciliation contracts
 * OUTPUT: parsed recovery inspection and one exact operator-authorized resume request
 * POS: ui/lib — no automatic replay, retry loop or execution authority
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import { SUBAGENT_METHODS, SubagentInboxRecoveryResultSchema, SubagentInboxResumeResultSchema,
  type SubagentInboxRecoveryParams, type SubagentInboxResumeParams } from "@taki/shared";

export function subagentInboxMethods(request: <T>(method: string, params: JSONRPCParams) => Promise<T>) {
  return {
    subagentInboxRecovery: async (params: SubagentInboxRecoveryParams) =>
      SubagentInboxRecoveryResultSchema.parse(await request(SUBAGENT_METHODS.inboxRecovery, params)),
    subagentInboxResume: async (params: SubagentInboxResumeParams) =>
      SubagentInboxResumeResultSchema.parse(await request(SUBAGENT_METHODS.inboxResume, params)),
  };
}
