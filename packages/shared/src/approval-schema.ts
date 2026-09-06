/**
 * INPUT:  canonical Approval request/respond/closed/list/revoke payload candidates
 * OUTPUT: strict operator schemas, bounded command-disclosure metadata and exact literal reconstruction
 * POS:    shared/approval — presentation never becomes execution input or authorization authority
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

export const APPROVAL_COMMAND_DISCLOSURE_REVISION = 1;
export const ApprovalCommandDisclosureSchema = z.strictObject({
  revision: z.literal(APPROVAL_COMMAND_DISCLOSURE_REVISION),
  complete: z.literal(true),
  encoding: z.literal("visible-escapes"),
  reconstruction: z.literal("section-field-concat"),
});
export type ApprovalCommandDisclosure = z.infer<typeof ApprovalCommandDisclosureSchema>;

const commandEncoder = new TextEncoder();

function validCommandChunk(value: string): boolean {
  // Iteration keeps Unicode scalars intact but exposes an unpaired surrogate as its own code point.
  for (const scalar of value) {
    const code = scalar.codePointAt(0) ?? 0;
    if (code >= 0xD800 && code <= 0xDFFF) return false;
  }
  return commandEncoder.encode(value).byteLength <= 500;
}

export const ApprovalPresentationSchema = z.strictObject({
  revision: z.literal(APPROVAL_PRESENTATION_REVISION),
  title: z.string().min(1).max(120),
  capabilityLabel: z.string().min(1).max(120),
  subjectLabel: z.string().min(1).max(160).optional(),
  riskSummary: PresentationTextSchema,
  sections: z.array(ApprovalPresentationSectionSchema).min(1).max(8),
  commandDisclosure: ApprovalCommandDisclosureSchema.optional(),
}).superRefine((presentation, ctx) => {
  if (!presentation.commandDisclosure) return;
  for (const [sectionIndex, section] of presentation.sections.entries()) {
    for (const [fieldIndex, field] of section.fields.entries()) {
      if (!validCommandChunk(field.value)) ctx.addIssue({
        code: "custom",
        message: "command chunks must be valid Unicode within 500 UTF-8 bytes and UTF-16 units",
        path: ["sections", sectionIndex, "fields", fieldIndex, "value"],
      });
    }
  }
});
export type ApprovalPresentation = z.infer<typeof ApprovalPresentationSchema>;

/** Only typed command fields participate; transport grouping must never insert source whitespace. */
export function reconstructApprovalCommand(presentation: ApprovalPresentation): string | undefined {
  if (!presentation.commandDisclosure) return undefined;
  return presentation.sections.flatMap((section) => section.fields.map((field) => field.value)).join("");
}

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
