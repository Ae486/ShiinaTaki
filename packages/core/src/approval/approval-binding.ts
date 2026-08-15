/**
 * INPUT:  current/stored Approval bindings plus the canonical governance registry
 * OUTPUT: SHA-256 digests, current-binding validation, and registry/disclosure usability classification
 * POS:    core/approval — pure authority helper; never accepts raw execution input or presentation data
 */
import { createHash } from "node:crypto";
import {
  APPROVAL_BINDING_REVISION,
  APPROVAL_DISCLOSURE_REVISION,
  ApprovalDecisionBindingSchema,
  ApprovalDurableDecisionBindingSchema,
  ApprovalDecisionInertReasonSchema,
  canonicalApprovalDecisionScope,
  canonicalApprovalDurableDecisionBinding,
  canonicalStoredApprovalDurableDecisionBinding,
  governanceCell,
  governanceDescriptor,
  type ApprovalDecisionScope,
  type ApprovalDecisionBinding,
  type ApprovalDurableDecisionBinding,
  type ApprovalStoredDurableDecisionBinding,
  type GovernanceRegistry,
} from "@taki/shared";
import type { z } from "zod";

export type ApprovalInertReason = z.infer<typeof ApprovalDecisionInertReasonSchema>;

export class ApprovalBindingValidationError extends Error {
  readonly reason: ApprovalInertReason;

  constructor(reason: ApprovalInertReason, message: string) {
    super(message);
    this.name = "ApprovalBindingValidationError";
    this.reason = reason;
  }
}

export function approvalDecisionScopeDigest(scope: ApprovalDecisionScope): string {
  return sha256(canonicalApprovalDecisionScope(scope));
}

export function approvalBindingDigest(binding: ApprovalDurableDecisionBinding): string {
  return sha256(canonicalApprovalDurableDecisionBinding(binding));
}

export function storedApprovalBindingDigest(binding: ApprovalStoredDurableDecisionBinding): string {
  return sha256(canonicalStoredApprovalDurableDecisionBinding(binding));
}

export function validateCurrentApprovalBinding(
  registry: GovernanceRegistry,
  candidate: unknown,
): ApprovalDurableDecisionBinding {
  const binding = ApprovalDurableDecisionBindingSchema.parse(candidate);
  const reason = approvalBindingInertReason(registry, binding, APPROVAL_DISCLOSURE_REVISION);
  if (reason) throw new ApprovalBindingValidationError(reason, `Approval binding is not usable: ${reason}`);
  return binding;
}

export function validateCurrentApprovalDecisionBinding(
  registry: GovernanceRegistry,
  candidate: unknown,
): ApprovalDecisionBinding {
  const binding = ApprovalDecisionBindingSchema.parse(candidate);
  const descriptor = governanceDescriptor(registry, binding.identity.capabilityId);
  if (!descriptor) throw new ApprovalBindingValidationError("unknown_capability", "Approval binding is not usable: unknown_capability");
  if (descriptor.subjectRequired !== (binding.identity.subject !== undefined)) {
    throw new ApprovalBindingValidationError("subject_binding_mismatch", "Approval binding is not usable: subject_binding_mismatch");
  }
  if (binding.descriptorRevision !== descriptor.descriptorRevision) {
    throw new ApprovalBindingValidationError("descriptor_revision_mismatch", "Approval binding is not usable: descriptor_revision_mismatch");
  }
  if (binding.classifierId !== descriptor.classifier.classifierId
    || binding.classifierRevision !== descriptor.classifier.classifierRevision) {
    throw new ApprovalBindingValidationError("classifier_mismatch", "Approval binding is not usable: classifier_mismatch");
  }
  if (!governanceCell(descriptor, binding.cellKey)) {
    throw new ApprovalBindingValidationError("unknown_cell", "Approval binding is not usable: unknown_cell");
  }
  const expected = approvalDecisionScopeDigest({
    bindingRevision: binding.bindingRevision,
    identity: binding.identity,
    descriptorRevision: binding.descriptorRevision,
    classifierId: binding.classifierId,
    classifierRevision: binding.classifierRevision,
    cellKey: binding.cellKey,
  });
  if (binding.decisionScopeDigest !== expected) {
    throw new ApprovalBindingValidationError("decision_scope_mismatch", "Approval binding is not usable: decision_scope_mismatch");
  }
  return binding;
}

export function approvalBindingInertReason(
  registry: GovernanceRegistry,
  binding: ApprovalStoredDurableDecisionBinding,
  disclosureRevision: number,
): ApprovalInertReason | undefined {
  if (binding.bindingRevision !== APPROVAL_BINDING_REVISION) return "binding_revision_mismatch";
  const descriptor = governanceDescriptor(registry, binding.identity.capabilityId);
  if (!descriptor) return "unknown_capability";
  const currentIdentity = ApprovalDurableDecisionBindingSchema.shape.identity.safeParse(binding.identity);
  if (!currentIdentity.success) return "subject_binding_mismatch";
  if (descriptor.subjectRequired !== (binding.identity.subject !== undefined)) return "subject_binding_mismatch";
  if (binding.descriptorRevision !== descriptor.descriptorRevision) return "descriptor_revision_mismatch";
  if (binding.classifierId !== descriptor.classifier.classifierId
    || binding.classifierRevision !== descriptor.classifier.classifierRevision) return "classifier_mismatch";
  const cell = governanceCell(descriptor, binding.cellKey);
  if (!cell) return "unknown_cell";
  if (cell.approvalMemory !== "rememberable") return "approval_memory_once_only";
  if (binding.disclosureRevision !== disclosureRevision) return "disclosure_revision_mismatch";
  const expectedScopeDigest = approvalDecisionScopeDigest({
    bindingRevision: APPROVAL_BINDING_REVISION,
    identity: binding.identity,
    descriptorRevision: binding.descriptorRevision,
    classifierId: binding.classifierId,
    classifierRevision: binding.classifierRevision,
    cellKey: binding.cellKey,
  });
  if (binding.decisionScopeDigest !== expectedScopeDigest) return "decision_scope_mismatch";
  return undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
