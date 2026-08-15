/**
 * INPUT:  canonical capability identities, descriptor registries, policy snapshots, and evaluation candidates
 * OUTPUT: strict Zod schemas/types for the extension-neutral governance contract shared by Core adapters
 * POS:    shared/governance — authority keys and descriptor metadata; display names, paths, and extension hints stay out
 */
import { z } from "zod";
import { PermissionCellKeySchema, PermissionLevelSchema, PermissionPostureSchema } from "./permission-level-schema.ts";

export const GovernanceRevisionSchema = z.number().int().positive();
export const GovernanceStableIdSchema = z.string().min(1).max(240).regex(/^[a-z0-9][a-z0-9._:-]*$/);

export const CanonicalCapabilitySubjectSchema = z.strictObject({
  subjectId: GovernanceStableIdSchema,
  revision: GovernanceStableIdSchema,
});
export type CanonicalCapabilitySubject = z.infer<typeof CanonicalCapabilitySubjectSchema>;

export const CanonicalCapabilityIdentitySchema = z.strictObject({
  capabilityId: GovernanceStableIdSchema,
  ownerHostId: z.uuid(),
  subject: CanonicalCapabilitySubjectSchema.optional(),
});
export type CanonicalCapabilityIdentity = z.infer<typeof CanonicalCapabilityIdentitySchema>;

export const GovernanceClassifierAuthoritySchema = z.enum(["core", "host"]);
export const GovernanceApprovalMemorySchema = z.enum(["rememberable", "once-only"]);
export const GovernanceOverrideModeSchema = z.enum(["ordinary", "second-confirm", "immutable"]);
/** Structured model-tool outcomes are distinct from JSON-RPC app ErrorCode values. */
export const GovernanceExecutionCodeSchema = z.enum(["GOVERNANCE_DENIED", "APPROVAL_REQUIRED"]);
export type GovernanceExecutionCode = z.infer<typeof GovernanceExecutionCodeSchema>;

export const GovernanceCellDescriptorSchema = z.strictObject({
  key: PermissionCellKeySchema,
  levels: z.strictObject({
    strict: PermissionPostureSchema,
    standard: PermissionPostureSchema,
    relaxed: PermissionPostureSchema,
  }),
  approvalMemory: GovernanceApprovalMemorySchema,
  overrideMode: GovernanceOverrideModeSchema,
});
export type GovernanceCellDescriptor = z.infer<typeof GovernanceCellDescriptorSchema>;

export const CapabilityGovernanceDescriptorSchema = z.strictObject({
  capabilityId: GovernanceStableIdSchema,
  descriptorRevision: GovernanceRevisionSchema,
  subjectRequired: z.boolean(),
  classifier: z.strictObject({
    authority: GovernanceClassifierAuthoritySchema,
    classifierId: GovernanceStableIdSchema,
    classifierRevision: GovernanceRevisionSchema,
  }),
  cells: z.array(GovernanceCellDescriptorSchema).min(1),
});
export type CapabilityGovernanceDescriptor = z.infer<typeof CapabilityGovernanceDescriptorSchema>;

export const GovernanceRegistrySchema = z.strictObject({
  registryRevision: GovernanceRevisionSchema,
  descriptors: z.array(CapabilityGovernanceDescriptorSchema).min(1),
});
export type GovernanceRegistry = z.infer<typeof GovernanceRegistrySchema>;

export const GovernanceOverrideSchema = z.strictObject({
  key: PermissionCellKeySchema,
  level: PermissionLevelSchema,
  posture: PermissionPostureSchema,
  descriptorRevision: GovernanceRevisionSchema,
});
export type GovernanceOverride = z.infer<typeof GovernanceOverrideSchema>;

export const GovernanceEvaluationInputSchema = z.strictObject({
  identity: CanonicalCapabilityIdentitySchema,
  registryRevision: GovernanceRevisionSchema,
  descriptorRevision: GovernanceRevisionSchema,
  classifierId: GovernanceStableIdSchema,
  classifierRevision: GovernanceRevisionSchema,
  cellKey: PermissionCellKeySchema,
  level: PermissionLevelSchema,
  policyGeneration: GovernanceRevisionSchema,
  override: GovernanceOverrideSchema.nullable().optional(),
  denyConstraints: z.array(z.string().min(1).max(120)).default([]),
});
export type GovernanceEvaluationInput = z.infer<typeof GovernanceEvaluationInputSchema>;

export const GovernanceEvaluationReasonSchema = z.enum([
  "factory",
  "operator-override",
  "deny-constraint",
  "unknown-capability",
  "subject-binding-mismatch",
  "registry-revision-mismatch",
  "descriptor-revision-mismatch",
  "classifier-mismatch",
  "unknown-cell",
  "override-mismatch",
]);

export const GovernanceEvaluationResultSchema = z.strictObject({
  identity: CanonicalCapabilityIdentitySchema,
  cellKey: PermissionCellKeySchema,
  descriptorRevision: GovernanceRevisionSchema,
  policyGeneration: GovernanceRevisionSchema,
  posture: PermissionPostureSchema,
  reason: GovernanceEvaluationReasonSchema,
});
export type GovernanceEvaluationResult = z.infer<typeof GovernanceEvaluationResultSchema>;
