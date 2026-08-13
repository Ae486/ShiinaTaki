/**
 * INPUT:  canonical capability identities and durable Approval decision candidates
 * OUTPUT: binding/scope serializers, revision constants, durable rows, usability, and list DTO schemas
 * POS:    shared/approval — authority identity contract; display text and exact execution input are excluded
 */
import { z } from "zod";
import { CanonicalCapabilityIdentitySchema, GovernanceRevisionSchema, GovernanceStableIdSchema } from "./governance-schema.ts";
import { Sha256HexSchema } from "./host-control-schema.ts";
import { PermissionCellKeySchema } from "./permission-level-schema.ts";

export const APPROVAL_BINDING_REVISION = 1;
export const APPROVAL_PRESENTATION_REVISION = 1;
export const APPROVAL_DISCLOSURE_REVISION = 1;

export const ApprovalDecisionScopeSchema = z.strictObject({
  bindingRevision: z.literal(APPROVAL_BINDING_REVISION),
  identity: CanonicalCapabilityIdentitySchema,
  descriptorRevision: GovernanceRevisionSchema,
  classifierId: GovernanceStableIdSchema,
  classifierRevision: GovernanceRevisionSchema,
  cellKey: PermissionCellKeySchema,
});
export type ApprovalDecisionScope = z.infer<typeof ApprovalDecisionScopeSchema>;

export const ApprovalDecisionBindingSchema = z.strictObject({
  bindingRevision: z.literal(APPROVAL_BINDING_REVISION),
  identity: CanonicalCapabilityIdentitySchema,
  descriptorRevision: GovernanceRevisionSchema,
  classifierId: GovernanceStableIdSchema,
  classifierRevision: GovernanceRevisionSchema,
  cellKey: PermissionCellKeySchema,
  decisionScopeDigest: Sha256HexSchema,
});
export type ApprovalDecisionBinding = z.infer<typeof ApprovalDecisionBindingSchema>;

export const ApprovalDurableDecisionBindingSchema = ApprovalDecisionBindingSchema.extend({
  disclosureRevision: z.literal(APPROVAL_DISCLOSURE_REVISION),
});
export type ApprovalDurableDecisionBinding = z.infer<typeof ApprovalDurableDecisionBindingSchema>;

// Stored authority is parsed independently from the current registry grammar. A later
// syntax tightening must leave historical rows readable so the service can classify
// them as inert instead of failing before reconciliation can report the drift.
const HistoricalAuthorityIdSchema = z.string().min(1).max(240);
const HistoricalOwnerHostIdSchema = z.string().min(1).max(240);
const HistoricalCapabilityIdentitySchema = z.strictObject({
  capabilityId: HistoricalAuthorityIdSchema,
  ownerHostId: HistoricalOwnerHostIdSchema,
  subject: z.strictObject({
    subjectId: HistoricalAuthorityIdSchema,
    revision: HistoricalAuthorityIdSchema,
  }).optional(),
});

export const ApprovalStoredDurableDecisionBindingSchema = z.strictObject({
  bindingRevision: GovernanceRevisionSchema,
  identity: HistoricalCapabilityIdentitySchema,
  descriptorRevision: GovernanceRevisionSchema,
  classifierId: HistoricalAuthorityIdSchema,
  classifierRevision: GovernanceRevisionSchema,
  cellKey: HistoricalAuthorityIdSchema,
  decisionScopeDigest: Sha256HexSchema,
  disclosureRevision: GovernanceRevisionSchema,
});
export type ApprovalStoredDurableDecisionBinding = z.infer<typeof ApprovalStoredDurableDecisionBindingSchema>;

export const ApprovalDecisionProvenanceSchema = z.enum(["operator", "legacy-reconfirmation"]);
export type ApprovalDecisionProvenance = z.infer<typeof ApprovalDecisionProvenanceSchema>;

export const ApprovalDurableDecisionSchema = z.strictObject({
  decisionId: z.uuid(),
  binding: ApprovalStoredDurableDecisionBindingSchema,
  bindingDigest: Sha256HexSchema,
  provenance: ApprovalDecisionProvenanceSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ApprovalDurableDecision = z.infer<typeof ApprovalDurableDecisionSchema>;

export const ApprovalDecisionInertReasonSchema = z.enum([
  "binding_revision_mismatch", "unknown_capability", "subject_binding_mismatch", "descriptor_revision_mismatch",
  "classifier_mismatch", "unknown_cell", "approval_memory_once_only",
  "disclosure_revision_mismatch", "decision_scope_mismatch", "binding_digest_mismatch",
]);
export const ApprovalDecisionUsabilitySchema = z.discriminatedUnion("usable", [
  z.strictObject({ usable: z.literal(true) }),
  z.strictObject({ usable: z.literal(false), reason: ApprovalDecisionInertReasonSchema }),
]);
export type ApprovalDecisionUsability = z.infer<typeof ApprovalDecisionUsabilitySchema>;

export const ApprovalSafeLabelsSchema = z.strictObject({
  capability: z.string().min(1).max(240).optional(),
  subject: z.string().min(1).max(240).optional(),
}).refine((labels) => labels.capability !== undefined || labels.subject !== undefined, {
  message: "at least one safe Approval label is required",
});
export type ApprovalSafeLabels = z.infer<typeof ApprovalSafeLabelsSchema>;

export const ApprovalDecisionListItemSchema = z.strictObject({
  decisionId: z.uuid(),
  verdict: z.literal("allow"),
  binding: ApprovalStoredDurableDecisionBindingSchema,
  bindingDigest: Sha256HexSchema,
  provenance: ApprovalDecisionProvenanceSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  labels: ApprovalSafeLabelsSchema.optional(),
  usability: ApprovalDecisionUsabilitySchema,
});
export type ApprovalDecisionListItem = z.infer<typeof ApprovalDecisionListItemSchema>;

export function canonicalApprovalDecisionScope(input: ApprovalDecisionScope): string {
  const scope = ApprovalDecisionScopeSchema.parse(input);
  return JSON.stringify({
    domain: "taki.approval.decision-scope",
    revision: scope.bindingRevision,
    identity: canonicalIdentity(scope.identity),
    descriptorRevision: scope.descriptorRevision,
    classifierId: scope.classifierId,
    classifierRevision: scope.classifierRevision,
    cellKey: scope.cellKey,
  });
}

export function canonicalApprovalDurableDecisionBinding(input: ApprovalDurableDecisionBinding): string {
  const binding = ApprovalDurableDecisionBindingSchema.parse(input);
  return serializeDurableBinding(binding);
}

export function canonicalStoredApprovalDurableDecisionBinding(input: ApprovalStoredDurableDecisionBinding): string {
  const binding = ApprovalStoredDurableDecisionBindingSchema.parse(input);
  return serializeDurableBinding(binding);
}

function serializeDurableBinding(binding: ApprovalStoredDurableDecisionBinding): string {
  return JSON.stringify({
    domain: "taki.approval.binding",
    revision: binding.bindingRevision,
    identity: canonicalIdentity(binding.identity),
    descriptorRevision: binding.descriptorRevision,
    classifierId: binding.classifierId,
    classifierRevision: binding.classifierRevision,
    cellKey: binding.cellKey,
    decisionScopeDigest: binding.decisionScopeDigest,
    disclosureRevision: binding.disclosureRevision,
  });
}

function canonicalIdentity(identity: z.infer<typeof HistoricalCapabilityIdentitySchema>) {
  return {
    capabilityId: identity.capabilityId,
    ownerHostId: identity.ownerHostId,
    ...(identity.subject === undefined ? {} : {
      subject: { subjectId: identity.subject.subjectId, revision: identity.subject.revision },
    }),
  };
}
