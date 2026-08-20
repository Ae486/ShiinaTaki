/**
 * INPUT: MethodRegistry plus the Skill lifecycle service and Logger
 * OUTPUT: registerSkillMethods(...) for the operator-only skill.* management family
 * POS:    core/server/methods boundary; domain failures are sanitized before registry echo points
 */
import { ErrorCodeSchema, SKILL_METHODS, SkillImportParamsSchema, SkillInspectParamsSchema, SkillListParamsSchema, SkillMutationParamsSchema, SkillReconcileParamsSchema, type SkillImportParams, type SkillInspectParams, type SkillMutationParams } from "@taki/shared";
import type { Logger } from "../../logging/logger.ts";
import { SkillConfigConflictError, SkillRepoRefusedError } from "../../skills/skill-package-repo.ts";
import { SkillRefusedError, type SkillLifecycleService } from "../../skills/skill-lifecycle-service.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition, MethodRegistry } from "../method-registry.ts";

export function registerSkillMethods(registry: MethodRegistry, deps: { service: SkillLifecycleService; logger: Logger }): void {
  registry.register({ method: SKILL_METHODS.list, roles: ["operator"], paramsSchema: SkillListParamsSchema, handler: () => guarded(deps, () => deps.service.list()) });
  registry.register({ method: SKILL_METHODS.inspect, roles: ["operator"], paramsSchema: SkillInspectParamsSchema, handler: (params: SkillInspectParams) => guarded(deps, () => deps.service.inspect(params)) });
  registry.register({ method: SKILL_METHODS.import, roles: ["operator"], paramsSchema: SkillImportParamsSchema, handler: (params: SkillImportParams) => guarded(deps, () => deps.service.import(params)) });
  registry.register(mutation(SKILL_METHODS.enable, deps, (params) => deps.service.enable(params)));
  registry.register(mutation(SKILL_METHODS.disable, deps, (params) => deps.service.disable(params)));
  registry.register(mutation(SKILL_METHODS.remove, deps, (params) => deps.service.remove(params)));
  registry.register({ method: SKILL_METHODS.reconcile, roles: ["operator"], paramsSchema: SkillReconcileParamsSchema, handler: () => guarded(deps, () => deps.service.reconcile()) });
}

function mutation(method: string, deps: { service: SkillLifecycleService; logger: Logger }, run: (params: SkillMutationParams) => unknown): MethodDefinition<SkillMutationParams> { return { method, roles: ["operator"], paramsSchema: SkillMutationParamsSchema, handler: (params) => guarded(deps, () => run(params)) }; }
function guarded<T>(deps: { logger: Logger }, run: () => T): T {
  try { const result = run(); if (result instanceof Promise) return result.catch((error: unknown) => { throw sanitize(deps, error); }) as T; return result; } catch (error) { throw sanitize(deps, error); }
}
function sanitize(deps: { logger: Logger }, error: unknown): unknown {
  if (error instanceof SkillConfigConflictError) return appException(ErrorCodeSchema.enum.SKILL_CONFIG_CONFLICT, error.message, { currentConfigRevision: error.currentConfigRevision });
  if (error instanceof SkillRefusedError || error instanceof SkillRepoRefusedError) return appException(ErrorCodeSchema.enum.SKILL_REFUSED, error.message, { reason: error.reason });
  deps.logger.child({ mod: "skills" }).error({ err: error instanceof Error ? error.name : "unknown" }, "skill method failed");
  return appException(ErrorCodeSchema.enum.INTERNAL_ERROR, "skill lifecycle operation failed");
}
