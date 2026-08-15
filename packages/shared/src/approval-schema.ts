/**
 * INPUT:  canonical Approval request/respond/closed/list/revoke payload candidates
 * OUTPUT: strict versioned operator schemas with bounded redacted presentation and explicit choices
 * POS:    shared/approval — canonical operator lifecycle contract; raw execution input is intentionally absent
 */
import { z } from "zod";
import {
  APPROVAL_DISCLOSURE_REVISION,
  APPROVAL_PRESENTATION_REVISION,
  ApprovalDecisionBindingSchema,
  ApprovalDecisionListItemSchema,
} from "./approval-decision-schema.ts";
import { GovernanceRevisionSchema } from "./governance-schema.ts";

export const APPROVAL_METHODS = {
  request: "approval.request",
  respond: "approval.respond",
  closed: "approval.closed",
  list: "approval.list",
  revoke: "approval.revoke",
} as const;

export const ApprovalChoiceSchema = z.enum(["allow_once", "allow_session", "allow_always", "deny"]);
export type ApprovalChoice = z.infer<typeof ApprovalChoiceSchema>;

export const ApprovalDisclosureAckSchema = z.strictObject({
  revision: z.literal(APPROVAL_DISCLOSURE_REVISION),
  futureBackgroundUseAccepted: z.literal(true),
});
export type ApprovalDisclosureAck = z.infer<typeof ApprovalDisclosureAckSchema>;

const PresentationTextSchema = z.string().min(1).max(500);
const ApprovalPresentationFieldSchema = z.strictObject({
  label: z.string().min(1).max(80),
  value: PresentationTextSchema,
});
const ApprovalPresentationSectionSchema = z.strictObject({
  title: z.string().min(1).max(80),
  fields: z.array(ApprovalPresentationFieldSchema).min(1).max(12),
});

export const ApprovalPresentationSchema = z.strictObject({
  revision: z.literal(APPROVAL_PRESENTATION_REVISION),
  title: z.string().min(1).max(120),
  capabilityLabel: z.string().min(1).max(120),
  subjectLabel: z.string().min(1).max(160).optional(),
  riskSummary: PresentationTextSchema,
  sections: z.array(ApprovalPresentationSectionSchema).min(1).max(8),
});
export type ApprovalPresentation = z.infer<typeof ApprovalPresentationSchema>;

const AllowedChoicesSchema = z.array(ApprovalChoiceSchema).min(2).max(4)
  .refine((choices) => new Set(choices).size === choices.length, "approval choices must be unique")
  .refine((choices) => choices.includes("allow_once") && choices.includes("deny"), {
    message: "approval choices must include allow_once and deny",
  });

export const CanonicalApprovalRequestSchema = z.strictObject({
  approvalId: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
  policyGeneration: GovernanceRevisionSchema,
  approvalGeneration: GovernanceRevisionSchema,
  binding: ApprovalDecisionBindingSchema,
  disclosureRevision: z.literal(APPROVAL_DISCLOSURE_REVISION).optional(),
  allowedChoices: AllowedChoicesSchema,
  presentation: ApprovalPresentationSchema,
}).refine(
  (request) => request.allowedChoices.includes("allow_always") === (request.disclosureRevision !== undefined),
  { message: "allow_always requires the current disclosure revision", path: ["allowedChoices"] },
);
export type CanonicalApprovalRequest = z.infer<typeof CanonicalApprovalRequestSchema>;

export const CanonicalApprovalRespondParamsSchema = z.strictObject({
  approvalId: z.uuid(),
  choice: ApprovalChoiceSchema,
  expectedApprovalGeneration: GovernanceRevisionSchema,
  disclosure: ApprovalDisclosureAckSchema.optional(),
}).refine((params) => (params.choice === "allow_always") === (params.disclosure !== undefined), {
  message: "allow_always requires the current disclosure acknowledgement",
  path: ["disclosure"],
});
export type CanonicalApprovalRespondParams = z.infer<typeof CanonicalApprovalRespondParamsSchema>;

export const ApprovalRespondStatusSchema = z.enum([
  "accepted", "late", "wrong_session", "invalidated", "scope_not_allowed",
  "stale_generation", "disclosure_required",
]);
export const CanonicalApprovalRespondResultSchema = z.strictObject({
  status: ApprovalRespondStatusSchema,
  approvalGeneration: GovernanceRevisionSchema,
});
export type CanonicalApprovalRespondResult = z.infer<typeof CanonicalApprovalRespondResultSchema>;

export const ApprovalClosedReasonSchema = z.enum([
  "answered", "denied", "expired", "cancelled", "operator_disconnected",
  "host_disconnected", "policy_changed", "approval_generation_changed", "route_replaced",
]);
export type ApprovalClosedReason = z.infer<typeof ApprovalClosedReasonSchema>;
export const ApprovalClosedSchema = z.strictObject({
  approvalId: z.uuid(),
  reason: ApprovalClosedReasonSchema,
  approvalGeneration: GovernanceRevisionSchema,
});
export type ApprovalClosed = z.infer<typeof ApprovalClosedSchema>;

export const ApprovalListParamsSchema = z.strictObject({});
export const ApprovalListResultSchema = z.strictObject({
  approvalGeneration: GovernanceRevisionSchema,
  governanceRegistryRevision: GovernanceRevisionSchema,
  disclosureRevision: z.literal(APPROVAL_DISCLOSURE_REVISION),
  decisions: z.array(ApprovalDecisionListItemSchema),
});
export type ApprovalListParams = z.infer<typeof ApprovalListParamsSchema>;
export type ApprovalListResult = z.infer<typeof ApprovalListResultSchema>;

export const ApprovalRevokeParamsSchema = z.strictObject({
  decisionId: z.uuid(),
  expectedApprovalGeneration: GovernanceRevisionSchema,
});
export const ApprovalRevokeStatusSchema = z.enum(["revoked", "not_found", "stale_generation"]);
export const ApprovalRevokeResultSchema = z.strictObject({
  status: ApprovalRevokeStatusSchema,
  approvalGeneration: GovernanceRevisionSchema,
});
export type ApprovalRevokeParams = z.infer<typeof ApprovalRevokeParamsSchema>;
export type ApprovalRevokeResult = z.infer<typeof ApprovalRevokeResultSchema>;
