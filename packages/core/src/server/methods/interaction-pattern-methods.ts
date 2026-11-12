/**
 * INPUT: live authenticated operator requests and the canonical Pattern service
 * OUTPUT: strict query/CAS management methods with operator-derived actor identity
 * POS: core/server/methods — no model-provided reviewer and no permission approval mutation
 */
import {
  INTERACTION_PATTERN_METHODS, InteractionPatternListParamsSchema, InteractionPatternGetParamsSchema,
  InteractionPatternHistoryParamsSchema, InteractionPatternProposeParamsSchema, InteractionPatternConfirmParamsSchema,
  InteractionPatternChangeStateParamsSchema, InteractionPatternRollbackParamsSchema,
} from "@taki/shared";
import type { InteractionPatternService } from "../../initiative/patterns/pattern-service.ts";
import type { ConnectionRegistry } from "../connection-registry.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";
import { appException } from "../app-error.ts";

export function requireInitiativeOperator(ctx: MethodContext, connections: ConnectionRegistry): string {
  const state = ctx.connection.state;
  if (state.status !== "authenticated" || state.role !== "operator" || !connections.list().includes(ctx.connection)) {
    throw appException("FORBIDDEN", "A live operator connection is required");
  }
  return state.deviceId;
}

export function registerInteractionPatternMethods(registry: MethodRegistry, input: {
  service: InteractionPatternService; connections: ConnectionRegistry;
}): void {
  const { service, connections } = input;
  const actor = (ctx: MethodContext) => ({ kind: "operator" as const, operatorId: requireInitiativeOperator(ctx, connections) });
  registry.register({ method: INTERACTION_PATTERN_METHODS.list, roles: ["operator"], paramsSchema: InteractionPatternListParamsSchema,
    handler(params, ctx) { actor(ctx); return service.list(params); } });
  registry.register({ method: INTERACTION_PATTERN_METHODS.get, roles: ["operator"], paramsSchema: InteractionPatternGetParamsSchema,
    handler(params, ctx) { actor(ctx); return { pattern: service.get(params) }; } });
  registry.register({ method: INTERACTION_PATTERN_METHODS.history, roles: ["operator"], paramsSchema: InteractionPatternHistoryParamsSchema,
    handler(params, ctx) { actor(ctx); return service.history(params); } });
  registry.register({ method: INTERACTION_PATTERN_METHODS.propose, roles: ["operator"], paramsSchema: InteractionPatternProposeParamsSchema,
    handler(params, ctx) { return service.propose(params, actor(ctx)); } });
  registry.register({ method: INTERACTION_PATTERN_METHODS.confirm, roles: ["operator"], paramsSchema: InteractionPatternConfirmParamsSchema,
    handler(params, ctx) { return service.confirm(params, actor(ctx)); } });
  registry.register({ method: INTERACTION_PATTERN_METHODS.changeState, roles: ["operator"], paramsSchema: InteractionPatternChangeStateParamsSchema,
    handler(params, ctx) { return service.changeState(params, actor(ctx)); } });
  registry.register({ method: INTERACTION_PATTERN_METHODS.rollback, roles: ["operator"], paramsSchema: InteractionPatternRollbackParamsSchema,
    handler(params, ctx) { return service.rollback(params, actor(ctx)); } });
}
