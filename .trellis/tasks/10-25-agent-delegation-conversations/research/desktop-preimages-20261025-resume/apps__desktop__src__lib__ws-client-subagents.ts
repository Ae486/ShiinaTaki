/**
 * INPUT: deadline-bound operator requests and the shared private-conversation schemas
 * OUTPUT: parsed child queries/controls and one retryable subscription per physical client
 * POS: ui/lib — wire boundary only; no offline queue or automatic mutation replay
 */
import type { JSONRPCParams } from "json-rpc-2.0";
import { SUBAGENT_METHODS, SubagentListResultSchema, SubagentHistoryResultSchema,
  SubagentResultViewSchema, SubagentControlResultSchema, SubagentSubscribeResultSchema,
  type SubagentListParams, type SubagentHistoryParams, type SubagentResultParams,
  type SubagentSendParams, type SubagentStopParams, type SubagentListResult, type SubagentHistoryResult } from "@taki/shared";

export type SubagentHistory = SubagentHistoryResult;
export type SubagentList = SubagentListResult;
type Request = <T>(method: string, params: JSONRPCParams) => Promise<T>;

export function subagentMethods(request: Request) {
  let subscribed: Promise<"supported"> | null = null;
  return {
    subagentList: async (params: SubagentListParams) =>
      SubagentListResultSchema.parse(await request(SUBAGENT_METHODS.list, params)),
    subagentHistory: async (params: SubagentHistoryParams) =>
      SubagentHistoryResultSchema.parse(await request(SUBAGENT_METHODS.history, params)),
    subagentResult: async (params: SubagentResultParams) =>
      SubagentResultViewSchema.parse(await request(SUBAGENT_METHODS.result, params)),
    subagentSend: async (params: SubagentSendParams) =>
      SubagentControlResultSchema.parse(await request(SUBAGENT_METHODS.send, params)),
    subagentStop: async (params: SubagentStopParams) =>
      SubagentControlResultSchema.parse(await request(SUBAGENT_METHODS.stop, params)),
    subagentContinue: async (params: SubagentSendParams) =>
      SubagentControlResultSchema.parse(await request(SUBAGENT_METHODS.continue, params)),
    subscribeSubagents(): Promise<"supported"> {
      if (subscribed) return subscribed;
      const attempt = request(SUBAGENT_METHODS.subscribe, {}).then((value): "supported" => {
        SubagentSubscribeResultSchema.parse(value);
        return "supported";
      }).catch((cause: unknown) => { if (subscribed === attempt) subscribed = null; throw cause; });
      subscribed = attempt;
      return attempt;
    },
  };
}
export type SubagentMethods = ReturnType<typeof subagentMethods>;
