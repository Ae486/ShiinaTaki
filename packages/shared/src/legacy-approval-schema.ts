/**
 * INPUT:  retained pre-Slice-4 MCP Approval payloads used by dormant Core and current legacy clients
 * OUTPUT: legacy request/respond/scope schemas under compatibility-only names
 * POS:    shared/approval — dormant migration compatibility; not canonical authority or a production writer
 */
import { z } from "zod";

export const LegacyApprovalScopeSchema = z.enum(["once", "session", "always"]);
export type LegacyApprovalScope = z.infer<typeof LegacyApprovalScopeSchema>;

export const LegacyApprovalRequestSchema = z.object({
  approvalId: z.string().min(1),
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
});
export type LegacyApprovalRequest = z.infer<typeof LegacyApprovalRequestSchema>;

export const LegacyApprovalRespondParamsSchema = z.object({
  approvalId: z.string().min(1),
  approved: z.boolean(),
  scope: LegacyApprovalScopeSchema,
});
export type LegacyApprovalRespondParams = z.infer<typeof LegacyApprovalRespondParamsSchema>;

export const LegacyApprovalRespondResultSchema = z.object({ accepted: z.boolean() });
export type LegacyApprovalRespondResult = z.infer<typeof LegacyApprovalRespondResultSchema>;
