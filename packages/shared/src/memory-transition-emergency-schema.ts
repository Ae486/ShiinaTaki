/**
 * INPUT:  the separately confirmed emergency intent and surviving Core snapshot
 * OUTPUT: immutable offline capture identity and honest per-Bank evidence coordinates
 * POS:    shared transition protocol — none of these values certifies a fresh native boundary
 */
import { z } from "zod";
import { MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";
import { TakiApplicationNamespaceSchema, TakiApplicationBodyRefSchema } from "./hindsight-application-primitives-schema.ts";
import { TakiApplicationArtifactSchema } from "./hindsight-application-artifact-schema.ts";
import { TakiApplicationNativeHeadSchema } from "./hindsight-application-native-schema.ts";
import { HindsightSnapshotRecordWireSchema } from "./hindsight-native-snapshot-schema.ts";
import { MemoryTransitionCandidateSchema } from "./memory-transition-candidate-schema.ts";
import { MemoryTransitionPublicationSchema } from "./memory-transition-publication-schema.ts";

const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Cursor = z.int().nonnegative();
export const MemoryEmergencyCaptureSchema = z.strictObject({
  version: z.literal(1), captureId: z.uuid(), transitionId: z.uuid(), incidentId: z.uuid(),
  operationId: z.uuid(), attemptId: z.uuid(), generation: z.int().positive(),
  predecessorEpochId: Id, identityHash: Hash, createdAt: z.iso.datetime({ offset: true }),
});
export type MemoryEmergencyCapture = z.infer<typeof MemoryEmergencyCaptureSchema>;

export const MemoryEmergencyBankCoverageSchema = z.strictObject({
  bankId: Id, scope: MemoryBankScopeSchema, nativeGeneration: Id.nullable(),
  replicaCursor: Cursor.nullable(), applicationNativeCursor: Cursor.nullable(), applicationStateCursor: Cursor.nullable(),
  backupNativeCursor: Cursor.nullable(), backupApplicationNativeCursor: Cursor.nullable(), backupApplicationStateCursor: Cursor.nullable(),
  pendingCount: Cursor.nullable(), checkpointHash: Hash.nullable(), survivingEvidenceId: Hash.nullable(),
  evidence: z.enum(["paired-replica", "native-only", "missing", "unreadable", "incompatible"]),
  // Even two equal local coordinates cannot bound the unseen remote head during an outage.
  remoteHead: z.literal("unknown"), remoteLoss: z.literal("unknown"),
});
export type MemoryEmergencyBankCoverage = z.infer<typeof MemoryEmergencyBankCoverageSchema>;
export const MemoryEmergencyUnknownEffectSchema = z.strictObject({
  table: z.enum(["pending_memory", "hindsight_memory_write_intents", "hindsight_application_command_jobs", "hindsight_ingestion_spans"]),
  epochId: Id, recordKey: z.string().min(1).max(1024), rowHash: Hash, disposition: z.literal("held-unknown"),
});
export type MemoryEmergencyUnknownEffect = z.infer<typeof MemoryEmergencyUnknownEffectSchema>;
export const MemoryEmergencySnapshotSchema = z.strictObject({
  capture: MemoryEmergencyCaptureSchema,
  banks: z.array(MemoryEmergencyBankCoverageSchema).min(1).max(1024),
  tables: z.array(z.strictObject({ table: Id, count: Cursor, hash: Hash })).min(1),
  unknownEffects: z.array(MemoryEmergencyUnknownEffectSchema),
  factsHash: Hash,
}).superRefine((value, context) => {
  if (new Set(value.banks.map((bank) => bank.bankId)).size !== value.banks.length
    || new Set(value.tables.map((table) => table.table)).size !== value.tables.length) {
    context.addIssue({ code: "custom", message: "emergency snapshot inventory must be unique" });
  }
});
export type MemoryEmergencySnapshot = z.infer<typeof MemoryEmergencySnapshotSchema>;

/** Original replica bytes are local surviving evidence, never a native transition certificate. */
export const MemorySurvivingBankEvidenceSchema = z.strictObject({
  version: z.literal(1), kind: z.literal("surviving-replica"), evidenceId: Hash, transitionId: z.uuid(), captureId: z.uuid(),
  bankId: Id, namespace: TakiApplicationNamespaceSchema, checkpointHash: Hash,
  nativeSnapshotId: Id, applicationSnapshotId: Id,
  nativeCursor: Cursor, applicationCursor: Cursor,
  heads: z.array(TakiApplicationNativeHeadSchema), artifacts: z.array(TakiApplicationArtifactSchema),
  bodies: z.array(z.strictObject({ ref: TakiApplicationBodyRefSchema, base64: z.string() })),
  nativeRecords: z.array(HindsightSnapshotRecordWireSchema),
});
export type MemorySurvivingBankEvidence = z.infer<typeof MemorySurvivingBankEvidenceSchema>;

export const MemoryEmergencyCandidateSchema = z.strictObject({
  ...MemoryTransitionCandidateSchema.shape, version: z.literal(2), kind: z.literal("emergency-surviving"),
  incidentId: z.uuid(), incidentHash: Hash, captureId: z.uuid(),
});
export type MemoryEmergencyCandidate = z.infer<typeof MemoryEmergencyCandidateSchema>;

export const MemoryEmergencyPublicationSchema = z.strictObject({
  ...MemoryTransitionPublicationSchema.shape,
  version: z.literal(2), kind: z.literal("emergency-surviving"), baselineId: z.null(),
  incidentId: z.uuid(), incidentHash: Hash, captureId: z.uuid(),
  unknownEffects: z.array(MemoryEmergencyUnknownEffectSchema),
});
export type MemoryEmergencyPublication = z.infer<typeof MemoryEmergencyPublicationSchema>;
