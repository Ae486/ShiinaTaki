/**
 * INPUT:  MethodRegistry plus the canonical ApprovalInteractionService
 * OUTPUT: registerApprovalMethods(...) — operator-only respond/list/revoke controllers bound to ctx.connection
 * POS:    core/server/methods — the only production registration seam for canonical Approval operator methods
 */
import {
  APPROVAL_METHODS,
  ApprovalListParamsSchema,
  ApprovalRevokeParamsSchema,
  CanonicalApprovalRespondParamsSchema,
  type ApprovalListParams,
  type ApprovalRevokeParams,
  type CanonicalApprovalRespondParams,
} from "@taki/shared";
import type { ApprovalInteractionService } from "../../approval/approval-interaction-service.ts";
import { ApprovalGenerationConflictError } from "../../approval/approval-state-repo.ts";
import type { MethodDefinition, MethodRegistry } from "../method-registry.ts";

export function registerApprovalMethods(registry: MethodRegistry, service: ApprovalInteractionService): void {
  registry.register(respond(service));
  registry.register(list(service));
  registry.register(revoke(service));
}

function respond(service: ApprovalInteractionService): MethodDefinition<CanonicalApprovalRespondParams> {
  return {
    method: APPROVAL_METHODS.respond,
    roles: ["operator"],
    paramsSchema: CanonicalApprovalRespondParamsSchema,
    handler: (params, ctx) => service.respond(ctx.connection, params),
  };
}

function list(service: ApprovalInteractionService): MethodDefinition<ApprovalListParams> {
  return {
    method: APPROVAL_METHODS.list,
    roles: ["operator"],
    paramsSchema: ApprovalListParamsSchema,
    handler: () => service.list(),
  };
}

function revoke(service: ApprovalInteractionService): MethodDefinition<ApprovalRevokeParams> {
  return {
    method: APPROVAL_METHODS.revoke,
    roles: ["operator"],
    paramsSchema: ApprovalRevokeParamsSchema,
    handler: (params) => {
      try {
        return service.revoke(params.decisionId, params.expectedApprovalGeneration);
      } catch (error) {
        if (error instanceof ApprovalGenerationConflictError) {
          return { status: "stale_generation", approvalGeneration: error.currentApprovalGeneration };
        }
        throw error;
      }
    },
  };
}
