/**
 * INPUT:  MethodRegistry plus the Core governance policy service and logger
 * OUTPUT: registerPermissionMethods(...) — operator-only permission.levelGet/levelSet/cellsGet/cellSet
 * POS:    core/server/methods — thin policy-authority controllers; no Agent tool reaches these mutations
 */
import {
  ErrorCodeSchema,
  PERMISSION_METHODS,
  PermissionCellSetParamsSchema,
  PermissionCellsGetParamsSchema,
  PermissionLevelGetParamsSchema,
  PermissionLevelSetParamsSchema,
  type PermissionCellSetParams,
  type PermissionCellsGetParams,
  type PermissionLevelGetParams,
  type PermissionLevelSetParams,
} from "@taki/shared";
import type { GovernancePolicyService } from "../../governance/governance-policy-service.ts";
import { GovernanceMutationError } from "../../governance/governance-policy-service.ts";
import { PolicyConflictError } from "../../governance/governance-policy-repo.ts";
import type { Logger } from "../../logging/logger.ts";
import { appException } from "../app-error.ts";
import type { MethodDefinition, MethodRegistry } from "../method-registry.ts";

export function registerPermissionMethods(registry: MethodRegistry, service: GovernancePolicyService, logger: Logger): void {
  registry.register(levelGet(service));
  registry.register(levelSet(service, logger));
  registry.register(cellsGet(service));
  registry.register(cellSet(service, logger));
}

function levelGet(service: GovernancePolicyService): MethodDefinition<PermissionLevelGetParams> {
  return { method: PERMISSION_METHODS.levelGet, roles: ["operator"], paramsSchema: PermissionLevelGetParamsSchema, handler: () => service.level() };
}

function levelSet(service: GovernancePolicyService, logger: Logger): MethodDefinition<PermissionLevelSetParams> {
  return {
    method: PERMISSION_METHODS.levelSet, roles: ["operator"], paramsSchema: PermissionLevelSetParamsSchema,
    handler: ({ level, expectedPolicyGeneration }) => runMutation(() => service.setLevel(level, expectedPolicyGeneration), logger, { level }),
  };
}

function cellsGet(service: GovernancePolicyService): MethodDefinition<PermissionCellsGetParams> {
  return { method: PERMISSION_METHODS.cellsGet, roles: ["operator"], paramsSchema: PermissionCellsGetParamsSchema, handler: () => service.cells() };
}

function cellSet(service: GovernancePolicyService, logger: Logger): MethodDefinition<PermissionCellSetParams> {
  return {
    method: PERMISSION_METHODS.cellSet, roles: ["operator"], paramsSchema: PermissionCellSetParamsSchema,
    handler: (params) => runMutation(() => service.setCell(params), logger, { key: params.key, level: params.level, reset: params.posture === null }),
  };
}

function runMutation<T>(mutate: () => T, logger: Logger, fields: Record<string, unknown>): T {
  try {
    const result = mutate();
    logger.child({ mod: "governance" }).info(fields, "governance policy stored");
    return result;
  } catch (error) {
    if (error instanceof PolicyConflictError) {
      throw appException(ErrorCodeSchema.enum.POLICY_CONFLICT, error.message, { currentPolicyGeneration: error.currentPolicyGeneration });
    }
    if (error instanceof GovernanceMutationError) {
      throw appException(ErrorCodeSchema.enum.GOVERNANCE_REFUSED, error.message, { reason: error.reason });
    }
    throw error;
  }
}
