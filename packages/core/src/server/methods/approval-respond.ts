/**
 * INPUT:  ApprovalRespondParams from a dispatched approval.respond request + an ApprovalBroker
 * OUTPUT: approvalRespondMethod(broker) -> MethodDefinition (operator-only); resolves the pending ask
 * POS:    core/server/methods — one file per WS method; the operator's answer to an approval.request notification
 */
import { APPROVAL_METHODS, ApprovalRespondParamsSchema, type ApprovalRespondParams, type ApprovalRespondResult } from "@taki/shared";
import type { ApprovalBroker } from "../../approval/approval-broker.ts";
import type { MethodDefinition } from "../method-registry.ts";

export function approvalRespondMethod(broker: ApprovalBroker): MethodDefinition<ApprovalRespondParams> {
  return {
    method: APPROVAL_METHODS.respond,
    roles: ["operator"], // approving is an operator concern; nodes are capability providers (mirrors chat.send)
    paramsSchema: ApprovalRespondParamsSchema,
    // Unknown/late approvalId -> {accepted:false} (the ask already timed out) — a normal answer, never an error.
    handler: (params): ApprovalRespondResult => broker.resolve(params),
  };
}
