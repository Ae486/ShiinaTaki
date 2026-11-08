/**
 * INPUT:  original candidate requests, admitted source commitments and existing Core/Host effect references
 * OUTPUT: bounded D1 durable-domain schemas; physical and restore proofs remain internal producer obligations
 * POS:    Shared candidate persistence/operation contract; no replay authority, scheduler or deployment readiness
 */
import { z } from "zod";
import { HindsightCustodyDigestSchema as Digest } from "./hindsight-custody-schema.ts";
import { HINDSIGHT_CANDIDATE_PROFILE, HindsightCandidateOwnershipSchema, HindsightCandidatePhysicalIdentitySchema,
  HindsightCandidateRefusalSchema, HindsightCandidateVerificationSchema } from "./hindsight-candidate-schema.ts";

const Id = z.string().min(1).max(256);
const Host = HindsightCandidateOwnershipSchema.omit({ candidateId: true });
export const HindsightCandidateActionSchema = z.enum(["reserve", "restore"]);
export const HindsightCandidatePhaseSchema = z.enum(["admitted", "reserved", "restore_dispatched", "restored_unverified", "baseline_verified"]);
export const HindsightCandidateErrorCodeSchema = z.enum(["HINDSIGHT_CANDIDATE_NOT_FOUND", "HINDSIGHT_CANDIDATE_CONFLICT",
  "HINDSIGHT_CANDIDATE_STALE", "HINDSIGHT_CANDIDATE_OPERATION_INACTIVE", "HINDSIGHT_CANDIDATE_INSPECTION_ONLY",
  "HINDSIGHT_CANDIDATE_PROOF_MISMATCH", "HINDSIGHT_CANDIDATE_STORAGE_INVALID", "HINDSIGHT_CANDIDATE_UNAVAILABLE"]);
export type HindsightCandidateErrorCode = z.infer<typeof HindsightCandidateErrorCodeSchema>;

const Prepare = z.strictObject({ kind: z.literal("candidate.prepare"), requestId: z.uuid(), backupId: z.uuid(),
  expectedEpochId: Id, expectedManifestHash: Digest });
const Continue = { requestId: z.uuid(), candidateId: z.uuid(), expectedPlanHash: Digest };
export const HindsightCandidateRequestSchema = z.discriminatedUnion("kind", [Prepare,
  z.strictObject({ kind: z.literal("candidate.inspect"), ...Continue }),
  z.strictObject({ kind: z.literal("candidate.resume"), ...Continue })]);
export type HindsightCandidateRequest = z.infer<typeof HindsightCandidateRequestSchema>;

/** Current admission currency is separate from the historical backup epoch and capture provenance. */
export const HindsightCandidateGuardSchema = z.strictObject({ authorityEpochId: Id, sourceAuthorityHash: Digest, custodyHash: Digest, host: Host });
export type HindsightCandidateGuard = z.infer<typeof HindsightCandidateGuardSchema>;
export const HindsightCandidatePlanSchema = z.strictObject({ version: z.literal(1), profile: z.literal(HINDSIGHT_CANDIDATE_PROFILE), request: Prepare,
  source: z.strictObject({ backupId: z.uuid(), manifestHash: Digest, coreSha256: Digest, archiveSha256: Digest,
    inventoryHash: Digest, backupRequestHash: Digest, authorityEpochId: Id, providerLineageId: z.uuid() }),
  guard: HindsightCandidateGuardSchema,
}).refine((value) => value.request.backupId === value.source.backupId && value.request.expectedManifestHash === value.source.manifestHash
  && value.request.expectedEpochId === value.guard.authorityEpochId, "request binds the admitted source and current epoch");
export type HindsightCandidatePlan = z.infer<typeof HindsightCandidatePlanSchema>;

/** Historical links to actual Run/Attempt/Effect and Host requests; persisted references do not renew admission. */
export const HindsightCandidateDispatchSchema = z.strictObject({ version: z.literal(1), candidateId: z.uuid(),
  action: HindsightCandidateActionSchema, runId: z.uuid(), attemptId: z.uuid(), effectId: z.uuid(), hostRequestId: z.uuid(),
  inputHash: Digest, authorityHash: Digest });
export type HindsightCandidateDispatch = z.infer<typeof HindsightCandidateDispatchSchema>;

/** Stopped restored storage has no API startup/listener yet; never invent those facts to reserve it. */
const Physical = HindsightCandidatePhysicalIdentitySchema.shape;
export const HindsightCandidateResourceSchema = z.strictObject({ version: Physical.version, role: z.literal("candidate"),
  resourceId: Physical.resourceId, coreHostId: Physical.coreHostId, executionHostId: Physical.executionHostId,
  installationId: Physical.installationId, engineId: Physical.engineId, imageId: Physical.imageId,
  containerId: Physical.containerId, volumes: Physical.volumes, postgres: Physical.postgres,
}).refine((value) => new Set(value.volumes.map((volume) => volume.name)).size === value.volumes.length
  && new Set(value.volumes.map((volume) => volume.backingId)).size === value.volumes.length, "unique physical storage");
export type HindsightCandidateResource = z.infer<typeof HindsightCandidateResourceSchema>;

/** Same-COPY-transaction receipt supplied by the eventual Native producer, never an equality-only inferred commit. */
export const HindsightCandidateRestoreReceiptSchema = z.strictObject({ version: z.literal(1), candidateId: z.uuid(),
  restoreRequestId: z.uuid(), restoreInputHash: Digest, receiptId: z.uuid(), receiptHash: Digest,
  archiveSha256: Digest, physicalIdentityHash: Digest });
export type HindsightCandidateRestoreReceipt = z.infer<typeof HindsightCandidateRestoreReceiptSchema>;

export const HindsightCandidateRecordSchema = z.strictObject({ version: z.literal(1), candidateId: z.uuid(), operationId: z.uuid(),
  planHash: Digest, plan: HindsightCandidatePlanSchema, admittedAt: z.iso.datetime({ offset: true }),
  phase: HindsightCandidatePhaseSchema, dispatches: z.array(HindsightCandidateDispatchSchema).max(2),
  resource: HindsightCandidateResourceSchema.nullable(), restore: HindsightCandidateRestoreReceiptSchema.nullable(),
  verification: HindsightCandidateVerificationSchema.nullable(), verificationIdentity: HindsightCandidatePhysicalIdentitySchema.nullable(),
}).refine((value) => new Set(value.dispatches.map((entry) => entry.action)).size === value.dispatches.length
  && value.dispatches.every((entry) => entry.candidateId === value.candidateId)
  && (value.resource === null || value.resource.resourceId === value.candidateId && value.resource.role === "candidate")
  && (value.restore === null || value.restore.candidateId === value.candidateId)
  && (value.verification === null || value.verification.candidateId === value.candidateId && value.verification.stage === "baseline_verified")
  && (value.verificationIdentity === null || value.verificationIdentity.resourceId === value.candidateId)
  && (value.verification === null) === (value.verificationIdentity === null)
  && (!value.resource || value.dispatches.some((entry) => entry.action === "reserve"))
  && (!value.restore || value.resource !== null && value.dispatches.some((entry) => entry.action === "restore"))
  && (!value.verification || value.restore !== null), "all facts name one original candidate");
export type HindsightCandidateRecord = z.infer<typeof HindsightCandidateRecordSchema>;

export const HindsightCandidateProducerRefSchema = z.strictObject({ kind: z.literal("candidate"), candidateId: z.uuid(), phase: HindsightCandidatePhaseSchema });
export type HindsightCandidateProducerRef = z.infer<typeof HindsightCandidateProducerRefSchema>;
export const HindsightCandidateResultSchema = z.strictObject({ kind: z.literal("candidate"), candidateId: z.uuid(), phase: HindsightCandidatePhaseSchema,
  unknownActions: z.array(HindsightCandidateActionSchema).max(2).refine((value) => new Set(value).size === value.length, "each action appears once"),
  verification: HindsightCandidateVerificationSchema.nullable(), refusal: HindsightCandidateRefusalSchema.nullable(),
}).refine((value) => value.verification === null || value.verification.candidateId === value.candidateId, "verification names the candidate");
export type HindsightCandidateResult = z.infer<typeof HindsightCandidateResultSchema>;
