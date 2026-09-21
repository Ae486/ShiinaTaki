/**
 * INPUT:  MethodRegistry, the Local onboarding service, the composite onboarding status read, the onboarding subscription
 *         registry and a Logger
 * OUTPUT: operator-only memory.onboarding.preview/status/exceptions/exclude/subscribe registrations + memory.onboarding.changed pushes
 * POS:    core/server/methods — thin sanitized read/short-command plane over the Core workspace; clients never pass paths or actors
 */
import {
  ErrorCodeSchema, MEMORY_ONBOARDING_METHODS, MemoryLocalErrorCodeSchema, MemoryOnboardingChangedSchema, MemoryOnboardingExceptionsParamsSchema,
  MemoryOnboardingExceptionsResultSchema, MemoryOnboardingExcludeParamsSchema, MemoryOnboardingExcludeResultSchema, MemoryOnboardingPreviewParamsSchema,
  MemoryOnboardingPreviewResultSchema, MemoryOnboardingStatusParamsSchema, MemoryOnboardingStatusSchema, MemoryOnboardingSubscribeParamsSchema,
  MemoryOnboardingSubscribeResultSchema, type MemoryOnboardingChanged, type MemoryOnboardingExceptionsParams, type MemoryOnboardingExcludeParams,
  type MemoryOnboardingStatus,
} from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import type { LocalOnboardingService } from "../../memory/local-onboarding/local-onboarding-service.ts";
import { MemoryOperationRefusal } from "../../memory/operations/memory-operation-contract.ts";
import { appException } from "../app-error.ts";
import type { ConnectionSubscriptions } from "../memory-operation-subscriptions.ts";
import type { MethodContext, MethodRegistry } from "../method-registry.ts";

export type MemoryOnboardingSubscriptions = ConnectionSubscriptions<MemoryOnboardingChanged>;

interface Deps {
  local: LocalOnboardingService;
  status(): MemoryOnboardingStatus;
  subscriptions: MemoryOnboardingSubscriptions;
  logger: Logger;
}

export function registerMemoryOnboardingMethods(registry: MethodRegistry, deps: Deps): void {
  registry.register({
    method: MEMORY_ONBOARDING_METHODS.preview, roles: ["operator"], paramsSchema: MemoryOnboardingPreviewParamsSchema,
    handler: () => guarded(deps, async () => MemoryOnboardingPreviewResultSchema.parse(await deps.local.preview())),
  });
  registry.register({
    method: MEMORY_ONBOARDING_METHODS.status, roles: ["operator"], paramsSchema: MemoryOnboardingStatusParamsSchema,
    handler: () => guarded(deps, () => MemoryOnboardingStatusSchema.parse(deps.status())),
  });
  registry.register({
    method: MEMORY_ONBOARDING_METHODS.exceptions, roles: ["operator"], paramsSchema: MemoryOnboardingExceptionsParamsSchema,
    handler: (params: MemoryOnboardingExceptionsParams) => guarded(deps, () => MemoryOnboardingExceptionsResultSchema.parse(deps.local.exceptions(params))),
  });
  registry.register({
    method: MEMORY_ONBOARDING_METHODS.exclude, roles: ["operator"], paramsSchema: MemoryOnboardingExcludeParamsSchema,
    handler: (params: MemoryOnboardingExcludeParams, ctx: MethodContext) => guarded(deps, () => {
      deps.local.exclude({ ...params, actor: actorOf(ctx) });
      return MemoryOnboardingExcludeResultSchema.parse(deps.status());
    }),
  });
  registry.register({
    method: MEMORY_ONBOARDING_METHODS.subscribe, roles: ["operator"], paramsSchema: MemoryOnboardingSubscribeParamsSchema,
    handler: (_params, ctx: MethodContext) => {
      // Connection-scoped and idempotent: a re-subscribe replaces the sink; a replacement socket subscribes again.
      deps.subscriptions.subscribe(ctx.connection, (changed) => ctx.notify(MEMORY_ONBOARDING_METHODS.changed, MemoryOnboardingChangedSchema.parse(changed)));
      ctx.onClose(() => deps.subscriptions.unsubscribe(ctx.connection));
      return MemoryOnboardingSubscribeResultSchema.parse({ status: "ok" });
    },
  });
}

/** The audit actor is the authenticated device, never a request field. */
function actorOf(ctx: MethodContext): string {
  const { state } = ctx.connection;
  if (state.status !== "authenticated") throw appException(ErrorCodeSchema.enum.NOT_AUTHENTICATED, "memory onboarding requires an authenticated operator");
  return state.deviceId;
}

async function guarded<T>(deps: Deps, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MemoryOperationRefusal) {
      throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "memory onboarding request was refused", { reason: error.reason });
    }
    const local = error instanceof Error ? MemoryLocalErrorCodeSchema.safeParse(error.message) : null;
    if (local?.success) throw appException(ErrorCodeSchema.enum.MEMORY_OPERATION_REFUSED, "memory onboarding request was refused", { reason: local.data });
    if (error instanceof Error && error.name === "ZodError") throw error;
    deps.logger.child({ mod: "memory-onboarding" }).error({ err: error instanceof Error ? error.name : "unknown" }, "memory onboarding method failed");
    throw appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "memory onboarding request failed");
  }
}
