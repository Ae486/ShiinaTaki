/**
 * INPUT:  strict versioned backup artifacts and Core-owned backup operation/status evidence
 * OUTPUT: explicit v1/v2 aggregate schemas, closed pair failures, status and emergency contracts
 * POS:    Shared backup protocol; version branches retain all template attestation through every consumer
 */
import { z } from "zod";
import { MemoryEmergencySnapshotSchema } from "./memory-transition-emergency-schema.ts";
import { HindsightBackupIdSchema, HindsightBackupRouteSchema, HindsightBackupInboxFileSchema,
  HindsightBackupNativeProofV1Schema, HindsightBackupNativeRequestV1Schema, HindsightBackupArchiveProofV1Schema,
  HindsightNativeArchiveManifestV1Schema, HindsightBackupManifestV1Schema } from "./hindsight-backup-v1-schema.ts";
import { HindsightBackupNativeRequestV2Schema, HindsightBackupNativeProofV2Schema,
  HindsightBackupArchiveProofV2Schema, HindsightBackupManifestV2Schema } from "./hindsight-backup-v2-schema.ts";

export { HindsightBackupIdSchema, HindsightBackupRouteSchema, HindsightBackupInboxFileSchema,
  HindsightCredentialCustodySchema } from "./hindsight-backup-v1-schema.ts";
export type { HindsightBackupRoute, HindsightCredentialCustody, HindsightBackupBank } from "./hindsight-backup-v1-schema.ts";

export const HindsightBackupNativeRequestSchema = z.discriminatedUnion("version", [
  HindsightBackupNativeRequestV1Schema, HindsightBackupNativeRequestV2Schema,
]);
export type HindsightBackupNativeRequest = z.infer<typeof HindsightBackupNativeRequestSchema>;
export const HindsightBackupNativeProofSchema = z.union([HindsightBackupNativeProofV1Schema, HindsightBackupNativeProofV2Schema]);
export type HindsightBackupNativeProof = z.infer<typeof HindsightBackupNativeProofSchema>;
export const HindsightBackupArchiveProofSchema = z.discriminatedUnion("version", [
  HindsightBackupArchiveProofV1Schema, HindsightBackupArchiveProofV2Schema,
]);
export type HindsightBackupArchiveProof = z.infer<typeof HindsightBackupArchiveProofSchema>;
export const HindsightNativeArchiveManifestSchema = HindsightNativeArchiveManifestV1Schema.extend({
  taki: HindsightBackupArchiveProofSchema.optional(),
});
export type HindsightNativeArchiveManifest = z.infer<typeof HindsightNativeArchiveManifestSchema>;
export const HindsightBackupManifestSchema = z.discriminatedUnion("version", [HindsightBackupManifestV1Schema, HindsightBackupManifestV2Schema]);
export type HindsightBackupManifest = z.infer<typeof HindsightBackupManifestSchema>;

const Id = z.string().min(1).max(256);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime({ offset: true });
const Cursor = z.int().nonnegative();
const Count = z.int().nonnegative();
type Fail = (message: string) => void;
const failWith = (context: z.RefinementCtx): Fail => (message) => context.addIssue({ code: "custom", message });
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

export const HindsightBackupPairMismatchReasonSchema = z.enum([
  "lineage", "native_bank_id", "bank_set", "generation", "replica_cursor", "application_native_cursor",
  "application_state_cursor", "receipt_scope", "receipt_missing",
  "template_proof_missing", "template_request", "template_inventory", "template_selection",
  "template_projection", "template_configuration", "template_unpublished",
]);
export type HindsightBackupPairMismatchReason = z.infer<typeof HindsightBackupPairMismatchReasonSchema>;
export const HindsightBackupPairMismatchSchema = z.strictObject({ reason: HindsightBackupPairMismatchReasonSchema, bankId: Id.nullable() });
export type HindsightBackupPairMismatch = z.infer<typeof HindsightBackupPairMismatchSchema>;

/** Per Bank: a comparable backup-to-local-replica interval only; null start means history is unproven.
 * No live remote head is captured: remote-only writes and total missing memory remain unknown even for equal cursors. */
const MissingIntervalSchema = z.array(z.strictObject({
  bankId: Id, fromNativeCursor: Cursor.nullable(), toReplicaCursor: Cursor.nullable(), pendingCount: Count.nullable(),
})).max(256).refine((banks) => unique(banks.map((bank) => bank.bankId)), "each Bank interval appears once");

/** The memory.authority.status `hindsight.backup` section; unknown stays null, never a fabricated zero. */
export const HindsightBackupStatusSectionSchema = z.strictObject({
  lastVerified: z.strictObject({
    backupId: HindsightBackupIdSchema, createdAt: Timestamp, verifiedAt: Timestamp,
    nativeCursors: z.array(z.strictObject({ bankId: Id, currentCursor: Cursor })).max(256),
  }).nullable(),
  ageSeconds: Count.nullable(),
  missingInterval: MissingIntervalSchema,
  /** The newest sealed backup whatever its verification, so one whose verify failed stays re-verifiable. */
  latest: z.strictObject({ backupId: HindsightBackupIdSchema, createdAt: Timestamp, verifiedAt: Timestamp.nullable() }).nullable(),
  /** Route-b captures of the current epoch still awaiting their native ZIP, newest first. */
  staged: z.array(z.strictObject({ backupId: HindsightBackupIdSchema, createdAt: Timestamp })).max(16),
}).superRefine((section, context) => {
  const fail = failWith(context);
  if ((section.lastVerified === null) !== (section.ageSeconds === null)) fail("backup age exists exactly with a verified backup");
  if (section.lastVerified === null && section.missingInterval.some((bank) => bank.fromNativeCursor !== null)) {
    fail("an interval starts from a verified backup only");
  }
  if (section.lastVerified !== null && !unique(section.lastVerified.nativeCursors.map((bank) => bank.bankId))) fail("each Bank cursor appears once");
  if (section.lastVerified !== null && section.latest === null) fail("a verified backup is a sealed one");
  if (!unique(section.staged.map((capture) => capture.backupId))) fail("each staged capture appears once");
});
export type HindsightBackupStatusSection = z.infer<typeof HindsightBackupStatusSectionSchema>;

/** Emergency evidence (never a full backup): a Core copy sealed without contacting native, pointing at the last verified pair. */
export const HindsightIncidentManifestSchema = z.strictObject({
  version: z.literal(1), kind: z.literal("incident-local"), fullBackup: z.literal(false),
  incidentId: z.uuid(), createdAt: Timestamp, authorityEpochId: Id.nullable(),
  core: z.strictObject({
    file: z.literal("core.sqlite"), sha256: Digest, bytes: z.int().positive(), pages: z.int().positive(), migrationHead: z.int().positive(),
  }),
  lastVerifiedBackupId: HindsightBackupIdSchema.nullable(), backupAgeSeconds: Count.nullable(),
  // Status remains a bounded display. An incident must represent every admitted Bank.
  missingInterval: z.array(z.strictObject({ bankId: Id, fromNativeCursor: Cursor.nullable(),
    toReplicaCursor: Cursor.nullable(), pendingCount: Count.nullable() })).max(1024),
  transition: MemoryEmergencySnapshotSchema.optional(),
}).refine((incident) => (incident.lastVerifiedBackupId === null) === (incident.backupAgeSeconds === null), "backup age exists exactly with a verified backup");
export type HindsightIncidentManifest = z.infer<typeof HindsightIncidentManifestSchema>;

export const MemoryBackupErrorCodeSchema = z.enum([
  "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE", "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT", "HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED",
  "HINDSIGHT_BACKUP_NATIVE_FAILED", "HINDSIGHT_BACKUP_PAIR_MISMATCH", "HINDSIGHT_BACKUP_PROOF_MISSING",
  "HINDSIGHT_BACKUP_ARTIFACT_INVALID", "HINDSIGHT_BACKUP_STORAGE_FAILED", "HINDSIGHT_BACKUP_TARGET_NOT_ISOLATED",
  "HINDSIGHT_BACKUP_NATIVE_INCOMPATIBLE", "HINDSIGHT_BACKUP_READBACK_MISMATCH", "HINDSIGHT_BACKUP_CREDENTIAL_MISSING",
  "HINDSIGHT_BACKUP_INTERNAL_ERROR", "HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN", "HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED",
  "HINDSIGHT_BACKUP_TEMPLATE_OBSERVATION_REQUIRED", "MEMORY_AUTHORITY_MISMATCH", "MEMORY_RUNTIME_UNAVAILABLE",
]);
export type MemoryBackupErrorCode = z.infer<typeof MemoryBackupErrorCodeSchema>;

/**
 * `native-endpoint` (default) snapshots native in the same paused operation; `operator-artifact` stages the Core copy plus
 * its native request and releases, and a later backup.admit pairs it with the operator's ZIP.
 */
export const MemoryBackupCaptureRequestSchema = z.strictObject({
  kind: z.literal("backup.capture"), expectedEpochId: Id, route: HindsightBackupRouteSchema.optional(),
});
/** Pairs the inbox ZIP with the staged route-b capture `backupId`; the ZIP's `taki.backupId` must echo it. */
export const MemoryBackupAdmitRequestSchema = z.strictObject({
  kind: z.literal("backup.admit"), expectedEpochId: Id, backupId: HindsightBackupIdSchema, fileName: HindsightBackupInboxFileSchema,
});
export const MemoryBackupVerifyRequestSchema = z.strictObject({ kind: z.literal("backup.verify"), backupId: HindsightBackupIdSchema });
export const MemoryBackupProducerRefSchema = z.strictObject({
  kind: z.literal("backup"), backupId: HindsightBackupIdSchema,
  phase: z.enum(["reserved", "quiescing", "capturing-core", "capturing-native", "verifying", "sealing", "completed"]),
});
export const MemoryBackupResultSchema = z.strictObject({
  kind: z.literal("backup"), backupId: HindsightBackupIdSchema, verifiedAt: Timestamp.nullable(),
  mismatch: HindsightBackupPairMismatchSchema.nullable(),
}).refine((result) => result.mismatch === null || result.verifiedAt === null, "a mismatched pair is never verified");
export type MemoryBackupCaptureRequest = z.infer<typeof MemoryBackupCaptureRequestSchema>;
export type MemoryBackupAdmitRequest = z.infer<typeof MemoryBackupAdmitRequestSchema>;
export type MemoryBackupVerifyRequest = z.infer<typeof MemoryBackupVerifyRequestSchema>;
export type MemoryBackupProducerRef = z.infer<typeof MemoryBackupProducerRefSchema>;
export type MemoryBackupResult = z.infer<typeof MemoryBackupResultSchema>;
