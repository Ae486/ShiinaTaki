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

export const HOST_CONTROL_PROTOCOL_VERSION = 1;
export const HOST_CATALOG_SCHEMA_VERSION = 1;

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

export const HostCapabilityDescriptorSchema = z.strictObject({
  capabilityId: z.string().min(1),
  execution: CapabilityExecutionKindSchema,
  cancellation: CapabilityCancellationSchema,
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

export const HostOperationControlSchema = z.strictObject({
  runId: z.uuid(),
  operationId: z.uuid(),
  attemptId: z.uuid(),
  targetHostId: z.uuid(),
  connectionGeneration: PositiveGenerationSchema,
  catalogGeneration: PositiveGenerationSchema,
  policyGeneration: PositiveGenerationSchema,
  approvalGeneration: PositiveGenerationSchema,
  capabilityId: z.string().min(1),
  inputDigest: Sha256HexSchema,
  idempotencyKey: z.uuid(),
  dispatchedAt: TimestampSchema,
  deadlineAt: TimestampSchema,
  expiresAt: TimestampSchema.optional(),
});
export type HostOperationControl = z.infer<typeof HostOperationControlSchema>;

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

export const CapabilityErrorCodeSchema = z.enum(["DENIED", "EXEC_FAILED", "UNSUPPORTED_CAPABILITY"]);
export type CapabilityErrorCode = z.infer<typeof CapabilityErrorCodeSchema>;

export const CapabilityErrorSchema = z.strictObject({
  code: CapabilityErrorCodeSchema,
  message: z.string(),
});
export type CapabilityError = z.infer<typeof CapabilityErrorSchema>;

export const CapabilityRespondParamsSchema = z.discriminatedUnion("state", [
  z.strictObject({
    requestId: z.uuid(),
    control: HostOperationControlSchema,
    state: z.literal("completed"),
    output: z.unknown(),
  }),
  z.strictObject({
    requestId: z.uuid(),
    control: HostOperationControlSchema,
    state: z.literal("failed"),
    error: CapabilityErrorSchema,
  }),
  z.strictObject({ requestId: z.uuid(), control: HostOperationControlSchema, state: z.literal("cancelled") }),
  z.strictObject({ requestId: z.uuid(), control: HostOperationControlSchema, state: z.literal("outcome_unknown") }),
]);
export type CapabilityRespondParams = z.infer<typeof CapabilityRespondParamsSchema>;

export const CapabilityChallengeSchema = z.strictObject({
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  challengeId: z.uuid(),
  reason: z.string().min(1).max(240),
});
export type CapabilityChallenge = z.infer<typeof CapabilityChallengeSchema>;

export const CapabilityResumeSchema = z.strictObject({
  requestId: z.uuid(),
  control: HostOperationControlSchema,
  challengeId: z.uuid(),
});
export type CapabilityResume = z.infer<typeof CapabilityResumeSchema>;
