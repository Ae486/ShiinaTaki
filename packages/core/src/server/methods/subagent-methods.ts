/**
 * INPUT: Shared child read/control schemas and authenticated operator connections
 * OUTPUT: exact targeted Core operations, explicit conflicts and subscription cleanup
 * POS: core/server/methods — thin protocol registration over the sole SubagentService owner
 */
import { JSON_RPC_ERROR_CODES, SUBAGENT_METHODS, SubagentListParamsSchema, SubagentHistoryParamsSchema, SubagentResultParamsSchema,
  SubagentSendParamsSchema, SubagentStopParamsSchema, SubagentContinueParamsSchema, SubagentSubscribeParamsSchema } from "@taki/shared";
import { SubagentConversationParamsSchema, SubagentConversationBodyParamsSchema, SubagentActivityReadParamsSchema, SubagentActivitySubscribeParamsSchema } from "@taki/shared";
import { SubagentInboxRecoveryParamsSchema, SubagentInboxResumeParamsSchema } from "@taki/shared";
import type { SubagentService } from "../../harness/subagent-service.ts";
import type { SubagentSubscriptions } from "../../harness/subagent-subscriptions.ts";
import type { MethodRegistry } from "../method-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { ZodType } from "zod";
import { appException } from "../app-error.ts";
import { JSONRPCErrorException } from "json-rpc-2.0";

export function registerSubagentMethods(registry: MethodRegistry, input: {
  service: SubagentService; subscriptions: SubagentSubscriptions; connections: ConnectionRegistry;
}): void {
  const add = <P>(method: string, schema: ZodType<P>, action: (params: P, ctx: MethodContext) => unknown) => {
    registry.register({ method, roles: ["operator"], paramsSchema: schema, handler(params, ctx) {
      if (ctx.connection.state.status !== "authenticated" || ctx.connection.state.role !== "operator"
        || !input.connections.list().includes(ctx.connection)) throw appException("FORBIDDEN", "A live operator connection is required");
      return guarded(() => action(params, ctx));
    } });
  };
  add(SUBAGENT_METHODS.list, SubagentListParamsSchema, (params) => input.service.list(params));
  add(SUBAGENT_METHODS.history, SubagentHistoryParamsSchema, (params) => input.service.history(params));
  add(SUBAGENT_METHODS.conversation, SubagentConversationParamsSchema, (params) => input.service.conversation(params));
  add(SUBAGENT_METHODS.conversationBody, SubagentConversationBodyParamsSchema, (params) => input.service.conversationBody(params));
  add(SUBAGENT_METHODS.inboxRecovery, SubagentInboxRecoveryParamsSchema, (params) => input.service.inboxRecovery(params));
  add(SUBAGENT_METHODS.inboxResume, SubagentInboxResumeParamsSchema, (params) => input.service.resumeInbox(params));
  add(SUBAGENT_METHODS.activityRead, SubagentActivityReadParamsSchema, (params) => input.service.activityRead(params));
  const activitySubscriptions = new Map<MethodContext["connection"], () => void>();
  const activityCleanup = new WeakSet<MethodContext["connection"]>();
  add(SUBAGENT_METHODS.activityUnsubscribe, SubagentSubscribeParamsSchema, (_params, ctx) => {
    activitySubscriptions.get(ctx.connection)?.(); activitySubscriptions.delete(ctx.connection); return { status: "ok" };
  });
  add(SUBAGENT_METHODS.activitySubscribe, SubagentActivitySubscribeParamsSchema, (params, ctx) => {
    input.service.activityRead(params);
    const previous = activitySubscriptions.get(ctx.connection);
    previous?.();
    const unsubscribe = input.service.activity.subscribe((event) => {
      if (ctx.connection.state.status !== "authenticated" || ctx.connection.state.role !== "operator"
        || !input.connections.list().includes(ctx.connection)) return;
      if (event.subagentId === params.subagentId && event.activity.characterId === params.characterId) ctx.notify(SUBAGENT_METHODS.activity, event);
    });
    activitySubscriptions.set(ctx.connection, unsubscribe);
    if (!activityCleanup.has(ctx.connection)) {
      activityCleanup.add(ctx.connection);
      ctx.onClose(() => { activitySubscriptions.get(ctx.connection)?.(); activitySubscriptions.delete(ctx.connection); });
    }
    return { status: "ok" };
  });
  add(SUBAGENT_METHODS.result, SubagentResultParamsSchema, (params) => input.service.result(params));
  add(SUBAGENT_METHODS.send, SubagentSendParamsSchema, (params) => input.service.send(params, { kind: "user" }));
  add(SUBAGENT_METHODS.continue, SubagentContinueParamsSchema, (params) => input.service.continue(params, { kind: "user" }));
  add(SUBAGENT_METHODS.stop, SubagentStopParamsSchema, (params) => input.service.stop(params, "user"));
  add(SUBAGENT_METHODS.subscribe, SubagentSubscribeParamsSchema, (_params, ctx) => {
      const added = input.subscriptions.subscribe(ctx.connection, (change) => ctx.notify(SUBAGENT_METHODS.changed, change));
      if (added) ctx.onClose(() => input.subscriptions.unsubscribe(ctx.connection));
      return { status: "ok" };
    });
}

async function guarded<T>(action: () => T): Promise<Awaited<T>> {
  try { return await action(); }
  catch (error) {
    const reason = error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message) ? error.message : "SUBAGENT_UNAVAILABLE";
    throw new JSONRPCErrorException("The requested child operation could not be applied. Refresh its current state before trying again.",
      JSON_RPC_ERROR_CODES.INVALID_PARAMS, { reason });
  }
}
