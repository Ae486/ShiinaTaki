/**
 * INPUT:  candidate approval.request notification payloads + approval.respond request params/results
 * OUTPUT: APPROVAL_METHODS names + ApprovalRequest/RespondParams/RespondResult schemas (+types)
 * POS:    shared/protocol — the operator tool-approval contract (M2 MCP gate; reused by the M3 Permission Gate)
 */
import { z } from "zod";

export const APPROVAL_METHODS = {
  // Core -> operator CLI as a notification (no envelope change; correlated by approvalId).
  request: "approval.request",
  // Operator CLI -> core as a normal request (operator-role method).
  respond: "approval.respond",
} as const;

// once = this call only; session = remember for the core's lifetime; always = persist the decision.
export const ApprovalScopeSchema = z.enum(["once", "session", "always"]);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

// input is the tool call's arguments, shown to the operator so they can judge the ask; it never enters core logs.
export const ApprovalRequestSchema = z.object({
  approvalId: z.string().min(1),
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalRespondParamsSchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  scope: ApprovalScopeSchema,
});
export type ApprovalRespondParams = z.infer<typeof ApprovalRespondParamsSchema>;

// accepted:false is the normal answer to an unknown/late respond (the ask already timed out) — never an error.
export const ApprovalRespondResultSchema = z.object({ accepted: z.boolean() });
export type ApprovalRespondResult = z.infer<typeof ApprovalRespondResultSchema>;
