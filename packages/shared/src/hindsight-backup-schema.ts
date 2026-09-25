/**
 * INPUT:  the Core identity read at capture, the native route's snapshot proof and Secret Catalog presence (never values)
 * OUTPUT: HindsightBackupManifestSchema, native proof, credential custody, pair-mismatch reasons, the memory.authority.status
 *         `hindsight.backup` section and the backup.capture/admit/verify request, producer, result and closed error-code schemas
 * POS:    shared/protocol — Stage 3 backup contracts; Core mints every backup id and path, a client names only a listed
 *         backup id or a plain inbox file name
 */
import { z } from "zod";
import { HindsightDeploymentModeSchema } from "./hindsight-connection-schema.ts";
import { SecretCatalogHealthSchema, SecretRefSchema } from "./secret-catalog-schema.ts";

const Id = z.string().min(1).max(256);
const Label = z.string().min(1).max(120);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime({ offset: true });
const Cursor = z.int().nonnegative();
const Count = z.int().nonnegative();
type Fail = (message: string) => void;
const failWith = (context: z.RefinementCtx): Fail => (message) => context.addIssue({ code: "custom", message });
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;

export const HindsightBackupIdSchema = z.uuid();
export const HindsightBackupRouteSchema = z.enum(["native-endpoint", "operator-artifact"]);
export type HindsightBackupRoute = z.infer<typeof HindsightBackupRouteSchema>;
/** A plain name inside `<dataDir>/backups/inbox/`: no separator, no leading dot and no device name can reach another path. */
export const HindsightBackupInboxFileSchema = z.string().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/)
  .refine((name) => !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name), "reserved device name");

const CustodyRefSchema = z.strictObject({
  ref: SecretRefSchema, present: z.boolean(), health: SecretCatalogHealthSchema,
  keyVersion: z.int().positive().nullable(), updatedAt: Timestamp.nullable(),
});
/** Presence and provenance of each Hindsight secret ref; a value or catalog envelope has no field to travel in. */
export const HindsightCredentialCustodySchema = z.strictObject({
  storeId: Id,
  refs: z.array(CustodyRefSchema).max(32),
  connectionMarker: Digest,
}).superRefine((custody, context) => {
  const fail = failWith(context);
  if (!unique(custody.refs.map((ref) => ref.ref))) fail("each secret ref appears once");
  for (const ref of custody.refs) {
    if (ref.present !== (ref.keyVersion !== null) || (ref.keyVersion === null) !== (ref.updatedAt === null)) {
      fail("exactly a present secret names its key version and update time");
    }
  }
});
export type HindsightCredentialCustody = z.infer<typeof HindsightCredentialCustodySchema>;

const NativeBankSchema = z.strictObject({
  bankId: Id, bankGeneration: z.uuid(), currentCursor: Cursor, minimumAvailableCursor: Cursor,
  application: z.strictObject({ nativeCursor: Cursor, stateCursor: Cursor }).nullable(),
});
/** Read by the native route inside the same REPEATABLE READ transaction as the snapshot it describes. */
export const HindsightBackupNativeProofSchema = z.strictObject({
  providerLineage: z.uuid(), alembicRevision: Label, upstreamCommit: Label, compatibilityBuild: Label,
  /** Exactly the Banks Core asked about, keyed by native Bank id. */
  banks: z.array(NativeBankSchema).max(256),
  /** Set membership of the Core-supplied terminal operation ids; count and digest name the list that was checked. */
  receipts: z.strictObject({ count: Count, digest: Digest, missingCount: Count, missingSample: z.array(Id).max(16) }),
  zipSha256: Digest, zipBytes: z.int().positive(),
}).superRefine((proof, context) => {
  const fail = failWith(context);
  if (!unique(proof.banks.map((bank) => bank.bankId))) fail("each native Bank appears once");
  const { count, missingCount, missingSample } = proof.receipts;
  if (missingCount > count || missingSample.length > missingCount || (missingCount > 0 && missingSample.length === 0)) {
    fail("missing receipts are a sampled subset of the checked list");
  }
});
export type HindsightBackupNativeProof = z.infer<typeof HindsightBackupNativeProofSchema>;

const CoreBankSchema = z.strictObject({
  bankId: Id, nativeBankId: Id, scope: z.enum(["global", "character"]), characterId: Id.nullable(),
  /** Null together with `core.replicaCursor` while the Bank has no B5 checkpoint yet. */
  bankGeneration: z.uuid().nullable(),
  core: z.strictObject({
    replicaCursor: Cursor.nullable(),
    /** The D77 application checkpoint: both cursors and its hash are null together. */
    applicationNativeCursor: Cursor.nullable(), applicationStateCursor: Cursor.nullable(), checkpointHash: Digest.nullable(),
  }),
});
export type HindsightBackupBank = z.infer<typeof CoreBankSchema>;

export const HindsightBackupManifestSchema = z.strictObject({
  version: z.literal(1),
  backupId: HindsightBackupIdSchema,
  createdAt: Timestamp,
  operationId: z.uuid(),
  route: HindsightBackupRouteSchema,
  core: z.strictObject({
    file: z.literal("core.sqlite"), sha256: Digest, bytes: z.int().positive(), pages: z.int().positive(), migrationHead: z.int().positive(),
  }),
  native: z.strictObject({
    /** `core-dir` keeps `native.zip` beside core.sqlite; `native-host` only references the ZIP on the native host. */
    location: z.enum(["core-dir", "native-host"]), file: z.string().min(1).max(1024),
    nativeManifestVersion: z.literal("2"), schema: Label, proof: HindsightBackupNativeProofSchema,
  }),
  authority: z.strictObject({
    epochId: Id, activationTransactionId: Id, providerLineageId: z.uuid(), replicaCheckpointDigest: Digest,
    configFingerprint: Digest, deploymentMode: HindsightDeploymentModeSchema,
  }),
  banks: z.array(CoreBankSchema).max(256),
  /** Core terminal write, Pending and ingestion ids at the Core copy; the native proof answers membership for this list. */
  terminalOperations: z.strictObject({ count: Count, digest: Digest }),
  custody: HindsightCredentialCustodySchema,
  /** The native ZIP carries webhook secrets, model prompts and the audit log by construction. */
  sensitive: z.literal(true),
  verifiedAt: Timestamp.nullable(),
}).superRefine((manifest, context) => {
  const fail = failWith(context);
  if (manifest.native.location === "core-dir" && manifest.native.file !== "native.zip") fail("a Core-held native artifact is native.zip");
  if (manifest.verifiedAt !== null && Date.parse(manifest.verifiedAt) < Date.parse(manifest.createdAt)) fail("verification precedes creation");
  if (!unique(manifest.banks.map((bank) => bank.bankId)) || !unique(manifest.banks.map((bank) => bank.nativeBankId))) {
    fail("each Bank and native Bank id appears once");
  }
  for (const bank of manifest.banks) refineBank(bank, fail);
});
export type HindsightBackupManifest = z.infer<typeof HindsightBackupManifestSchema>;

function refineBank(bank: HindsightBackupBank, fail: Fail): void {
  const { core } = bank;
  if ((bank.scope === "character") !== (bank.characterId !== null)) fail("Bank scope and Character binding disagree");
  if ((bank.bankGeneration === null) !== (core.replicaCursor === null)) fail("a Bank generation travels with its replica cursor");
  const application = [core.applicationNativeCursor, core.applicationStateCursor, core.checkpointHash].map((value) => value === null);
  if (new Set(application).size !== 1) fail("the application checkpoint is complete or absent");
}

export const HindsightBackupPairMismatchReasonSchema = z.enum([
  "lineage", "native_bank_id", "bank_set", "generation", "replica_cursor", "application_native_cursor",
  "application_state_cursor", "receipt_scope", "receipt_missing",
]);
export type HindsightBackupPairMismatchReason = z.infer<typeof HindsightBackupPairMismatchReasonSchema>;
export const HindsightBackupPairMismatchSchema = z.strictObject({ reason: HindsightBackupPairMismatchReasonSchema, bankId: Id.nullable() });
export type HindsightBackupPairMismatch = z.infer<typeof HindsightBackupPairMismatchSchema>;

/** The memory.authority.status `hindsight.backup` section; unknown stays null, never a fabricated zero. */
export const HindsightBackupStatusSectionSchema = z.strictObject({
  lastVerified: z.strictObject({
    backupId: HindsightBackupIdSchema, createdAt: Timestamp, verifiedAt: Timestamp,
    nativeCursors: z.array(z.strictObject({ bankId: Id, currentCursor: Cursor })).max(256),
  }).nullable(),
  ageSeconds: Count.nullable(),
  missingInterval: z.array(z.strictObject({
    bankId: Id, fromNativeCursor: Cursor.nullable(), toReplicaCursor: Cursor.nullable(), pendingCount: Count.nullable(),
  })).max(256),
}).superRefine((section, context) => {
  const fail = failWith(context);
  if ((section.lastVerified === null) !== (section.ageSeconds === null)) fail("backup age exists exactly with a verified backup");
  if (!unique(section.missingInterval.map((bank) => bank.bankId))) fail("each Bank interval appears once");
  if (section.lastVerified === null && section.missingInterval.some((bank) => bank.fromNativeCursor !== null)) {
    fail("an interval starts from a verified backup only");
  }
  if (section.lastVerified !== null && !unique(section.lastVerified.nativeCursors.map((bank) => bank.bankId))) fail("each Bank cursor appears once");
});
export type HindsightBackupStatusSection = z.infer<typeof HindsightBackupStatusSectionSchema>;

export const MemoryBackupErrorCodeSchema = z.enum([
  "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE", "HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT", "HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED",
  "HINDSIGHT_BACKUP_NATIVE_FAILED", "HINDSIGHT_BACKUP_PAIR_MISMATCH", "HINDSIGHT_BACKUP_PROOF_MISSING",
  "HINDSIGHT_BACKUP_ARTIFACT_INVALID", "HINDSIGHT_BACKUP_STORAGE_FAILED", "HINDSIGHT_BACKUP_TARGET_NOT_ISOLATED",
  "HINDSIGHT_BACKUP_NATIVE_INCOMPATIBLE", "HINDSIGHT_BACKUP_READBACK_MISMATCH", "HINDSIGHT_BACKUP_CREDENTIAL_MISSING",
  "HINDSIGHT_BACKUP_INTERNAL_ERROR", "MEMORY_AUTHORITY_MISMATCH", "MEMORY_RUNTIME_UNAVAILABLE",
]);
export type MemoryBackupErrorCode = z.infer<typeof MemoryBackupErrorCodeSchema>;

export const MemoryBackupCaptureRequestSchema = z.strictObject({ kind: z.literal("backup.capture"), expectedEpochId: Id });
export const MemoryBackupAdmitRequestSchema = z.strictObject({
  kind: z.literal("backup.admit"), expectedEpochId: Id, fileName: HindsightBackupInboxFileSchema,
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
