/**
 * INPUT:  canonical Approval decision and lifecycle schema modules
 * OUTPUT: named public Approval facade for operator clients and Core authority code
 * POS:    shared/approval — focused package API; legacy MCP Approval compatibility is exported separately
 */
export {
  APPROVAL_BINDING_REVISION, APPROVAL_DISCLOSURE_REVISION, APPROVAL_PRESENTATION_REVISION,
  ApprovalDecisionBindingSchema, ApprovalDecisionInertReasonSchema, ApprovalDecisionListItemSchema,
  ApprovalDecisionProvenanceSchema, ApprovalDecisionScopeSchema, ApprovalDecisionUsabilitySchema,
  ApprovalSafeLabelsSchema,
  ApprovalDurableDecisionBindingSchema, ApprovalDurableDecisionSchema,
  ApprovalStoredDurableDecisionBindingSchema,
  canonicalApprovalDecisionScope, canonicalApprovalDurableDecisionBinding,
  canonicalStoredApprovalDurableDecisionBinding,
} from "./approval-decision-schema.ts";
export type {
  ApprovalDecisionBinding, ApprovalDecisionListItem, ApprovalDecisionProvenance, ApprovalDecisionScope,
  ApprovalDecisionUsability, ApprovalDurableDecision, ApprovalDurableDecisionBinding,
  ApprovalSafeLabels,
  ApprovalStoredDurableDecisionBinding,
} from "./approval-decision-schema.ts";
export {
  APPROVAL_METHODS, ApprovalChoiceSchema, ApprovalClosedReasonSchema, ApprovalClosedSchema,
  ApprovalDisclosureAckSchema, ApprovalListParamsSchema, ApprovalListResultSchema,
  ApprovalPresentationSchema, ApprovalRespondStatusSchema, ApprovalRevokeParamsSchema,
  ApprovalRevokeResultSchema, ApprovalRevokeStatusSchema, CanonicalApprovalRequestSchema,
  CanonicalApprovalRespondParamsSchema, CanonicalApprovalRespondResultSchema,
} from "./approval-schema.ts";
export type {
  ApprovalChoice, ApprovalClosed, ApprovalClosedReason, ApprovalDisclosureAck, ApprovalListParams, ApprovalListResult,
  ApprovalPresentation, ApprovalRevokeParams, ApprovalRevokeResult, CanonicalApprovalRequest,
  CanonicalApprovalRespondParams, CanonicalApprovalRespondResult,
} from "./approval-schema.ts";
