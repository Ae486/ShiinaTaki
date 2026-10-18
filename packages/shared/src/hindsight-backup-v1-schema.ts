/**
 * INPUT:  historical v1 backup requests, proofs, copied authority and presence-only credential custody
 * OUTPUT: unchanged strict v1 contracts plus unrefined versioned bases for v2 and staged metadata
 * POS:    Shared historical backup boundary; v1 never accepts or silently strips template-v2 evidence
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

export const HindsightBackupNativeBankSchema = z.strictObject({
  bankId: Id, bankGeneration: z.uuid(), currentCursor: Cursor, minimumAvailableCursor: Cursor,
  application: z.strictObject({ nativeCursor: Cursor, stateCursor: Cursor }).nullable(),
});
export const HindsightBackupNativeProofBodyV1BaseSchema = z.strictObject({
  providerLineage: z.uuid(), alembicRevision: Label, upstreamCommit: Label, compatibilityBuild: Label,
  /** Exactly the Banks Core asked about, keyed by native Bank id. */
  banks: z.array(HindsightBackupNativeBankSchema).max(256),
  /** Set membership of the Core-supplied terminal operation ids; count and digest name the list that was checked. */
  receipts: z.strictObject({ count: Count, digest: Digest, missingCount: Count, missingSample: z.array(Id).max(16) }),
});
export function refineHindsightBackupNativeProof(proof: z.infer<typeof HindsightBackupNativeProofBodyV1BaseSchema>, context: z.RefinementCtx): void {
  const fail = failWith(context);
  if (!unique(proof.banks.map((bank) => bank.bankId))) fail("each native Bank appears once");
  const { count, missingCount, missingSample } = proof.receipts;
  if (missingCount > count || missingSample.length > missingCount || (missingCount > 0 && missingSample.length === 0)) {
    fail("missing receipts are a sampled subset of the checked list");
  }
}
export const HindsightBackupNativeProofBodyV1Schema = HindsightBackupNativeProofBodyV1BaseSchema.superRefine(refineHindsightBackupNativeProof);
export type HindsightBackupNativeProofBodyV1 = z.infer<typeof HindsightBackupNativeProofBodyV1Schema>;

/** Read by the native route inside the same REPEATABLE READ transaction as the snapshot it describes. */
export const HindsightBackupNativeProofV1Schema = HindsightBackupNativeProofBodyV1BaseSchema
  .extend({ zipSha256: Digest, zipBytes: z.int().positive() }).superRefine(refineHindsightBackupNativeProof);
export type HindsightBackupNativeProofV1 = z.infer<typeof HindsightBackupNativeProofV1Schema>;

/**
 * What Core asks the native side to snapshot and prove, minted at the Core copy: the route-c request body and the route-b
 * `native-request.json` the operator hands to the native CLI. Ids are printable ASCII (the receipt digest's byte order).
 */
export const HindsightBackupNativeRequestV1BaseSchema = z.strictObject({
  version: z.literal(1), backupId: HindsightBackupIdSchema, createdAt: Timestamp, providerLineageId: z.uuid(),
  nativeBankIds: z.array(Id).max(256),
  operationIds: z.array(z.string().regex(/^[\x21-\x7e]{1,256}$/)).max(1_000_000),
});
export const HindsightBackupNativeRequestV1Schema = HindsightBackupNativeRequestV1BaseSchema
  .refine((request) => unique(request.nativeBankIds) && unique(request.operationIds), "each Bank and operation id appears once");
export type HindsightBackupNativeRequestV1 = z.infer<typeof HindsightBackupNativeRequestV1Schema>;

export const HindsightBackupArchiveEntrySchema = z.strictObject({ name: z.string().regex(/^[A-Za-z0-9_]{1,63}\.bin$/), bytes: Count, sha256: Digest });
/**
 * The `taki` object of an operator-produced native ZIP's `manifest.json` (route b). The proof omits the ZIP digest (a ZIP
 * cannot hash itself; Core hashes the file) and instead pins every table entry, so the proof describes these exact bytes.
 */
export const HindsightBackupArchiveProofV1Schema = z.strictObject({
  version: z.literal(1),
  /** Echoes the request: the native snapshot began after the Core copy that minted this id. */
  backupId: HindsightBackupIdSchema,
  proof: HindsightBackupNativeProofBodyV1BaseSchema.superRefine(refineHindsightBackupNativeProof),
  entries: z.array(HindsightBackupArchiveEntrySchema).max(512),
}).refine((archive) => unique(archive.entries.map((entry) => entry.name)), "each archive entry appears once");
export type HindsightBackupArchiveProofV1 = z.infer<typeof HindsightBackupArchiveProofV1Schema>;

/** The native CLI manifest v2 (`manifest.json` in the ZIP); native-owned fields beyond these are ignored, `taki` is strict. */
export const HindsightNativeArchiveManifestV1Schema = z.object({
  version: z.literal("2"), created_at: z.string().min(1).max(64), schema: Label,
  tables: z.record(z.string().regex(/^[A-Za-z0-9_]{1,63}$/), z.object({ rows: Count, size_bytes: Count })),
  taki: HindsightBackupArchiveProofV1Schema.optional(),
});
export type HindsightNativeArchiveManifestV1 = z.infer<typeof HindsightNativeArchiveManifestV1Schema>;

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

export const HindsightBackupManifestV1BaseSchema = z.strictObject({
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
    nativeManifestVersion: z.literal("2"), schema: Label, proof: HindsightBackupNativeProofV1Schema,
  }),
  authority: z.strictObject({
    epochId: Id, activationTransactionId: Id.nullable(), transitionReceiptId: Digest.optional(), providerLineageId: z.uuid(), replicaCheckpointDigest: Digest,
    configFingerprint: Digest, deploymentMode: HindsightDeploymentModeSchema,
  }).refine((authority) => (authority.activationTransactionId === null) === (authority.transitionReceiptId !== undefined),
    "backup authority names exactly one activation or transition receipt"),
  banks: z.array(CoreBankSchema).max(256),
  /** Core terminal write, Pending and ingestion ids at the Core copy; the native proof answers membership for this list. */
  terminalOperations: z.strictObject({ count: Count, digest: Digest }),
  custody: HindsightCredentialCustodySchema,
  /** The native ZIP carries webhook secrets, model prompts and the audit log by construction. */
  sensitive: z.literal(true),
  verifiedAt: Timestamp.nullable(),
});

export function refineHindsightBackupManifest(
  manifest: Pick<z.infer<typeof HindsightBackupManifestV1BaseSchema>, "native" | "verifiedAt" | "createdAt" | "banks">,
  context: z.RefinementCtx,
): void {
  const fail = failWith(context);
  if (manifest.native.location === "core-dir" && manifest.native.file !== "native.zip") fail("a Core-held native artifact is native.zip");
  if (manifest.verifiedAt !== null && Date.parse(manifest.verifiedAt) < Date.parse(manifest.createdAt)) fail("verification precedes creation");
  if (!unique(manifest.banks.map((bank) => bank.bankId)) || !unique(manifest.banks.map((bank) => bank.nativeBankId))) {
    fail("each Bank and native Bank id appears once");
  }
  for (const bank of manifest.banks) refineBank(bank, fail);
}
export const HindsightBackupManifestV1Schema = HindsightBackupManifestV1BaseSchema.superRefine(refineHindsightBackupManifest);
export type HindsightBackupManifestV1 = z.infer<typeof HindsightBackupManifestV1Schema>;

function refineBank(bank: HindsightBackupBank, fail: Fail): void {
  const { core } = bank;
  if ((bank.scope === "character") !== (bank.characterId !== null)) fail("Bank scope and Character binding disagree");
  if ((bank.bankGeneration === null) !== (core.replicaCursor === null)) fail("a Bank generation travels with its replica cursor");
  const application = [core.applicationNativeCursor, core.applicationStateCursor, core.checkpointHash].map((value) => value === null);
  if (new Set(application).size !== 1) fail("the application checkpoint is complete or absent");
}
