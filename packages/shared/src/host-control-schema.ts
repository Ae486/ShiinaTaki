/**
 * INPUT:  Host handshake negotiation, catalog candidates, and sealed Host-bound operation frames
 * OUTPUT: HOST_CONTROL_METHODS plus canonical Host/catalog/control/cancel/settlement schemas and types
 * POS:    shared/protocol — the only Host-control wire contract; Node-handled shapes are serde-mirrored
 */
import { z } from "zod";

export const HOST_CONTROL_METHODS = {
  catalogPublish: "host.catalogPublish",
  request: "capability.request",
  challenge: "capability.challenge",
  resume: "capability.resume",
  cancel: "capability.cancel",
  respond: "capability.respond",
} as const;

export const HOST_CONTROL_PROTOCOL_VERSION = 3;
export const HOST_CATALOG_SCHEMA_VERSION = 2;

export const PositiveGenerationSchema = z.number().int().positive();
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const TimestampSchema = z.iso.datetime({ offset: true });

export const HostProtocolRangeSchema = z.strictObject({
  min: PositiveGenerationSchema,
  max: PositiveGenerationSchema,
}).refine((range) => range.min <= range.max, { message: "protocol min must be <= max", path: ["max"] });
export type HostProtocolRange = z.infer<typeof HostProtocolRangeSchema>;

export const HostDeclarationSchema = z.strictObject({
  protocol: HostProtocolRangeSchema,
  catalogSchemaVersions: z.array(PositiveGenerationSchema).min(1),
});
export type HostDeclaration = z.infer<typeof HostDeclarationSchema>;

export const HostNegotiationSchema = z.strictObject({
  hostId: z.uuid(),
  protocolVersion: PositiveGenerationSchema,
  catalogSchemaVersion: PositiveGenerationSchema,
  connectionGeneration: PositiveGenerationSchema,
});
export type HostNegotiation = z.infer<typeof HostNegotiationSchema>;

export const HostLocalReadinessSchema = z.enum(["ready", "unavailable"]);
export type HostLocalReadiness = z.infer<typeof HostLocalReadinessSchema>;

export const CapabilityExecutionKindSchema = z.enum(["read", "effect"]);
export type CapabilityExecutionKind = z.infer<typeof CapabilityExecutionKindSchema>;

export const CapabilityCancellationSchema = z.enum(["cooperative", "non-cooperative"]);
export type CapabilityCancellation = z.infer<typeof CapabilityCancellationSchema>;

export const HostCapabilityGovernanceSupportSchema = z.strictObject({
  descriptorRevision: PositiveGenerationSchema,
  classifierId: z.string().min(1).max(240),
  classifierRevision: PositiveGenerationSchema,
});
export type HostCapabilityGovernanceSupport = z.infer<typeof HostCapabilityGovernanceSupportSchema>;

export const HostCapabilityDescriptorSchema = z.strictObject({
  capabilityId: z.string().min(1),
  execution: CapabilityExecutionKindSchema,
  cancellation: CapabilityCancellationSchema,
  governance: HostCapabilityGovernanceSupportSchema,
});
export type HostCapabilityDescriptor = z.infer<typeof HostCapabilityDescriptorSchema>;

export const HostWorkspaceDescriptorSchema = z.strictObject({
  workspaceId: z.string().min(1),
  rootLabel: z.string().min(1).max(120),
  transferCapabilityIds: z.array(z.string().min(1)).default([]),
});
export type HostWorkspaceDescriptor = z.infer<typeof HostWorkspaceDescriptorSchema>;

export const HostSkillDescriptorSchema = z.strictObject({ skillId: z.string().min(1) });
export type HostSkillDescriptor = z.infer<typeof HostSkillDescriptorSchema>;

export const HostMcpDescriptorSchema = z.strictObject({
  mcpServerId: z.string().min(1),
  toolNames: z.array(z.string().min(1)).default([]),
});
export type HostMcpDescriptor = z.infer<typeof HostMcpDescriptorSchema>;

export const HostCatalogPublishParamsSchema = z.strictObject({
  hostId: z.uuid(),
  label: z.string().min(1).max(120),
  protocolVersion: PositiveGenerationSchema,
  catalogSchemaVersion: PositiveGenerationSchema,
  connectionGeneration: PositiveGenerationSchema,
  catalogGeneration: PositiveGenerationSchema,
  publishedAt: TimestampSchema,
  readiness: HostLocalReadinessSchema,
  localReason: z.string().min(1).max(240).optional(),
  capabilities: z.array(HostCapabilityDescriptorSchema),
  workspaces: z.array(HostWorkspaceDescriptorSchema).default([]),
  skills: z.array(HostSkillDescriptorSchema).default([]),
  mcpServers: z.array(HostMcpDescriptorSchema).default([]),
});
export type HostCatalogPublishParams = z.infer<typeof HostCatalogPublishParamsSchema>;

export const HostFrameRejectReasonSchema = z.enum([
  "wrong_host",
  "stale_generation",
  "unsupported_version",
  "invalid_catalog",
  "unknown_request",
  "duplicate",
  "late",
]);
export type HostFrameRejectReason = z.infer<typeof HostFrameRejectReasonSchema>;

export const HostFrameAckSchema = z.discriminatedUnion("accepted", [
  z.strictObject({ accepted: z.literal(true) }),
  z.strictObject({ accepted: z.literal(false), reason: HostFrameRejectReasonSchema }),
]);
export type HostFrameAck = z.infer<typeof HostFrameAckSchema>;

export const HostGovernanceCellSchema = z.strictObject({
  key: z.string().min(1),
  posture: z.enum(["auto", "ask", "deny"]),
});
export type HostGovernanceCell = z.infer<typeof HostGovernanceCellSchema>;

export const HostGovernanceProjectionPayloadSchema = z.strictObject({
  registryRevision: PositiveGenerationSchema,
  descriptorRevision: PositiveGenerationSchema,
  classifierRevision: PositiveGenerationSchema,
  cells: z.array(HostGovernanceCellSchema).min(1),
}).superRefine((projection, context) => {
  for (let index = 1; index < projection.cells.length; index += 1) {
    if (projection.cells[index - 1]!.key >= projection.cells[index]!.key) {
      context.addIssue({ code: "custom", message: "governance cells must be unique and canonically sorted", path: ["cells", index, "key"] });
    }
  }
});
export type HostGovernanceProjectionPayload = z.infer<typeof HostGovernanceProjectionPayloadSchema>;

export const HostGovernanceProjectionSchema = z.strictObject({
  registryRevision: PositiveGenerationSchema,
  descriptorRevision: PositiveGenerationSchema,
  classifierRevision: PositiveGenerationSchema,
  cells: z.array(HostGovernanceCellSchema).min(1),
  digest: Sha256HexSchema,
}).superRefine((projection, context) => {
  for (let index = 1; index < projection.cells.length; index += 1) {
    if (projection.cells[index - 1]!.key >= projection.cells[index]!.key) {
      context.addIssue({ code: "custom", message: "governance cells must be unique and canonically sorted", path: ["cells", index, "key"] });
    }
  }
});
export type HostGovernanceProjection = z.infer<typeof HostGovernanceProjectionSchema>;

export function canonicalHostGovernanceProjection(projection: HostGovernanceProjectionPayload): string {
  const parsed = HostGovernanceProjectionPayloadSchema.parse(projection);
  return JSON.stringify({
    registryRevision: parsed.registryRevision,
    descriptorRevision: parsed.descriptorRevision,
    classifierRevision: parsed.classifierRevision,
    cells: parsed.cells,
  });
}

export const HostOperationControlSchema = z.strictObject({
  runId: z.uuid(),
  operationId: z.uuid(),
  attemptId: z.uuid(),
  targetHostId: z.uuid(),
  connectionGeneration: PositiveGenerationSchema,
  catalogGeneration: PositiveGenerationSchema,
  policyGeneration: PositiveGenerationSchema,
  governanceProjection: HostGovernanceProjectionSchema,
  approvalGeneration: PositiveGenerationSchema,
  capabilityId: z.string().min(1),
  inputDigest: Sha256HexSchema,
  idempotencyKey: z.uuid(),
  dispatchedAt: TimestampSchema,
  deadlineAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(),
});
export type HostOperationControl = z.infer<typeof HostOperationControlSchema>;
export const HostGovernanceEvidenceSchema = z.strictObject({
  descriptorRevision: PositiveGenerationSchema,
  classifierRevision: PositiveGenerationSchema,
  cellKey: z.string().min(1),
  effectivePosture: z.enum(["auto", "ask", "deny"]),
  constraint: z.enum(["none", "legacy-deny", "local", "managed", "hard"]),
});
export type HostGovernanceEvidence = z.infer<typeof HostGovernanceEvidenceSchema>;

export const CapabilityRequestSchema = z.strictObject({
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  input: z.unknown(),
});
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

export const CapabilityCancelReasonSchema = z.enum([
  "caller_cancelled",
  "deadline_exceeded",
  "policy_revoked",
  "generation_retired",
  "approval_denied",
  "approval_invalidated",
]);
export type CapabilityCancelReason = z.infer<typeof CapabilityCancelReasonSchema>;

export const CapabilityCancelSchema = z.strictObject({
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  reason: CapabilityCancelReasonSchema,
});
export type CapabilityCancel = z.infer<typeof CapabilityCancelSchema>;

export const CapabilitySettlementStateSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
  "outcome_unknown",
]);
export type CapabilitySettlementState = z.infer<typeof CapabilitySettlementStateSchema>;

export const CapabilityErrorCodeSchema = z.enum(["DENIED", "APPROVAL_REQUIRED", "EXEC_FAILED", "UNSUPPORTED_CAPABILITY"]);
export type CapabilityErrorCode = z.infer<typeof CapabilityErrorCodeSchema>;

export const CapabilityErrorSchema = z.strictObject({
  code: CapabilityErrorCodeSchema,
  message: z.string(),
});
export type CapabilityError = z.infer<typeof CapabilityErrorSchema>;

export const CapabilityAuthorizationLineageSchema = z.strictObject({
  authorizationId: z.uuid(),
  approvalGeneration: PositiveGenerationSchema,
  challengeDigest: Sha256HexSchema,
});
export type CapabilityAuthorizationLineage = z.infer<typeof CapabilityAuthorizationLineageSchema>;

export const CapabilityRespondParamsSchema = z.discriminatedUnion("state", [
  z.strictObject({
    requestId: z.uuid(),
    control: HostOperationControlSchema,
    state: z.literal("completed"),
    output: z.unknown(),
    governance: HostGovernanceEvidenceSchema,
    authorization: CapabilityAuthorizationLineageSchema.optional(),
  }),
  z.strictObject({
    requestId: z.uuid(),
    control: HostOperationControlSchema,
    state: z.literal("failed"),
    error: CapabilityErrorSchema,
    governance: HostGovernanceEvidenceSchema,
    authorization: CapabilityAuthorizationLineageSchema.optional(),
  }),
  z.strictObject({ requestId: z.uuid(), control: HostOperationControlSchema, state: z.literal("cancelled"), authorization: CapabilityAuthorizationLineageSchema.optional() }),
  z.strictObject({ requestId: z.uuid(), control: HostOperationControlSchema, state: z.literal("outcome_unknown"), authorization: CapabilityAuthorizationLineageSchema.optional() }),
]).superRefine((params, context) => {
  // An ask-classified execution settles success ONLY under its Core-minted authorization lineage, and a
  // lineage may never vouch for an execution that was not ask-classified (Batch C frozen contract).
  if (params.state === "completed" && (params.governance.effectivePosture === "ask") !== (params.authorization !== undefined)) {
    context.addIssue({
      code: "custom",
      message: "a completed ask-classified execution requires matching authorization lineage",
      path: ["authorization"],
    });
  }
});
export type CapabilityRespondParams = z.infer<typeof CapabilityRespondParamsSchema>;
