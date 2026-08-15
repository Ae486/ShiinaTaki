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

export interface PermissionMethodDeps {
  service: GovernancePolicyService;
  logger: Logger;
  onChanged?: (policyGeneration: number) => void;
}

export function registerPermissionMethods(registry: MethodRegistry, deps: PermissionMethodDeps): void {
  registry.register(levelGet(deps.service));
  registry.register(levelSet(deps));
  registry.register(cellsGet(deps.service));
  registry.register(cellSet(deps));
}

function levelGet(service: GovernancePolicyService): MethodDefinition<PermissionLevelGetParams> {
  return { method: PERMISSION_METHODS.levelGet, roles: ["operator"], paramsSchema: PermissionLevelGetParamsSchema, handler: () => service.level() };
}

function levelSet(deps: PermissionMethodDeps): MethodDefinition<PermissionLevelSetParams> {
  return {
    method: PERMISSION_METHODS.levelSet, roles: ["operator"], paramsSchema: PermissionLevelSetParamsSchema,
    handler: ({ level, expectedPolicyGeneration }) => runMutation({
      mutate: () => deps.service.setLevel(level, expectedPolicyGeneration),
      logger: deps.logger,
      fields: { level },
      onChanged: changedNotifier(deps.onChanged, expectedPolicyGeneration),
    }),
  };
}

function cellsGet(service: GovernancePolicyService): MethodDefinition<PermissionCellsGetParams> {
  return { method: PERMISSION_METHODS.cellsGet, roles: ["operator"], paramsSchema: PermissionCellsGetParamsSchema, handler: () => service.cells() };
}

function cellSet(deps: PermissionMethodDeps): MethodDefinition<PermissionCellSetParams> {
  return {
    method: PERMISSION_METHODS.cellSet, roles: ["operator"], paramsSchema: PermissionCellSetParamsSchema,
    handler: (params) => runMutation({
      mutate: () => deps.service.setCell(params),
      logger: deps.logger,
      fields: { key: params.key, level: params.level, reset: params.posture === null },
      onChanged: changedNotifier(deps.onChanged, params.expectedPolicyGeneration),
    }),
  };
}

function changedNotifier(
  onChanged: PermissionMethodDeps["onChanged"],
  expectedPolicyGeneration: number,
): PermissionMethodDeps["onChanged"] {
  return onChanged
    ? (policyGeneration) => {
        if (policyGeneration !== expectedPolicyGeneration) onChanged(policyGeneration);
      }
    : undefined;
}

function runMutation<T extends { policyGeneration: number }>(input: {
  mutate: () => T;
  logger: Logger;
  fields: Record<string, unknown>;
  onChanged?: (policyGeneration: number) => void;
}): T {
  try {
    const result = input.mutate();
    input.logger.child({ mod: "governance" }).info(input.fields, "governance policy stored");
    input.onChanged?.(result.policyGeneration);
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
