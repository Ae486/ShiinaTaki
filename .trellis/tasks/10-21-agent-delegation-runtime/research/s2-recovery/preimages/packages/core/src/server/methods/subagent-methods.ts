/**
 * INPUT: Shared child read/control schemas and authenticated operator connections
 * OUTPUT: exact targeted Core operations, explicit conflicts and subscription cleanup
 * POS: core/server/methods — thin protocol registration over the sole SubagentService owner
 */
import { SUBAGENT_METHODS, SubagentListParamsSchema, SubagentHistoryParamsSchema, SubagentResultParamsSchema,
  SubagentSendParamsSchema, SubagentStopParamsSchema, SubagentContinueParamsSchema, SubagentSubscribeParamsSchema } from "@taki/shared";
import type { SubagentService } from "../../harness/subagent-service.ts";
import type { SubagentSubscriptions } from "../../harness/subagent-subscriptions.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";

export function registerSubagentMethods(registry: MethodRegistry, input: { service: SubagentService; subscriptions: SubagentSubscriptions }): void {
  const roles = ["operator" as const];
  registry.register({ method: SUBAGENT_METHODS.list, roles, paramsSchema: SubagentListParamsSchema,
    handler: (params) => guarded(() => input.service.list(params)) });
  registry.register({ method: SUBAGENT_METHODS.history, roles, paramsSchema: SubagentHistoryParamsSchema,
    handler: (params) => guarded(() => input.service.history(params)) });
  registry.register({ method: SUBAGENT_METHODS.result, roles, paramsSchema: SubagentResultParamsSchema,
    handler: (params) => guarded(() => input.service.result(params)) });
  registry.register({ method: SUBAGENT_METHODS.send, roles, paramsSchema: SubagentSendParamsSchema,
    handler: (params) => guarded(() => input.service.send(params, { kind: "user" })) });
  registry.register({ method: SUBAGENT_METHODS.continue, roles, paramsSchema: SubagentContinueParamsSchema,
    handler: (params) => guarded(() => input.service.continue(params, { kind: "user" })) });
  registry.register({ method: SUBAGENT_METHODS.stop, roles, paramsSchema: SubagentStopParamsSchema,
    handler: (params) => guarded(() => input.service.stop(params, "user")) });
  registry.register({ method: SUBAGENT_METHODS.subscribe, roles, paramsSchema: SubagentSubscribeParamsSchema,
    handler: (_params, ctx) => {
      const added = input.subscriptions.subscribe(ctx.connection, (change) => ctx.notify(SUBAGENT_METHODS.changed, change));
      if (added) ctx.onClose(() => input.subscriptions.unsubscribe(ctx.connection));
      return { status: "ok" };
    } });
}

function guarded<T>(action: () => T): T {
  try { return action(); }
  catch (error) {
    const reason = error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message) ? error.message : "SUBAGENT_UNAVAILABLE";
    throw appException("INVALID_PARAMS", "The requested child operation could not be applied. Refresh its current state before trying again.", { reason });
  }
}
