/**
 * INPUT:  LegacyApprovalRespondParams from the dormant Approval route + retained ApprovalBroker
 * OUTPUT: approvalRespondMethod(broker) -> retained operator-only legacy method definition
 * POS:    core/server/methods — compatibility handler not registered as canonical Batch-A Approval authority
 */
import {
  APPROVAL_METHODS,
  LegacyApprovalRespondParamsSchema,
  type LegacyApprovalRespondParams,
  type LegacyApprovalRespondResult,
} from "@taki/shared";
import type { ApprovalBroker } from "../../approval/approval-broker.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function approvalRespondMethod(broker: ApprovalBroker): MethodDefinition<LegacyApprovalRespondParams> {
  return {
    method: APPROVAL_METHODS.respond,
    roles: ["operator"], // approving is an operator concern; nodes are capability providers (mirrors chat.send)
    paramsSchema: LegacyApprovalRespondParamsSchema,
    // Unknown/late approvalId -> {accepted:false} (the ask already timed out) — a normal answer, never an error.
    handler: (params): LegacyApprovalRespondResult => broker.resolve(params),
  };
}
