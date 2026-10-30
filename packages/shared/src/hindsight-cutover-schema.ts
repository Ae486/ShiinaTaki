/**
 * INPUT:  bounded B4 import, fact-mapping, replica, and promotion data
 * OUTPUT: strict provider-neutral schemas for the initial Hindsight cutover
 * POS:    shared contract — durable migration state never carries secrets or raw provider payloads
 */
import { z } from "zod";
import { HindsightLocalCoverageStatusSchema } from "./hindsight-local-coverage-schema.ts";
import { HindsightLogicalJsonObjectSchema } from "./hindsight-native-snapshot-schema.ts";
import { HindsightCurrentStatusSchema } from "./hindsight-current-status-schema.ts";

const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const ContentIdentity = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime({ offset: true });

export const HINDSIGHT_CUTOVER_METHODS = {
  status: "memory.hindsight.cutover.status",
  verify: "memory.hindsight.cutover.verify",
} as const;

const CutoverId = z.string().min(1).max(256);
const CutoverPhase = z.enum(["importing", "replica-verified", "ready", "activated", "failed"]);
const CutoverStatus = z.enum(["running", "ready", "completed", "failed"]);

export const HindsightCutoverStatusParamsSchema = z.strictObject({ runId: CutoverId });
export const HindsightCutoverVerifyParamsSchema = z.strictObject({
  runId: CutoverId,
  expectedRevision: z.int().min(0),
  expectedEpochId: CutoverId,
});

const HindsightCutoverOperationCountsSchema = z.strictObject({
  pending: z.int().min(0), submitted: z.int().min(0), processing: z.int().min(0), completed: z.int().min(0),
  mapped: z.int().min(0), failed: z.int().min(0), cancelled: z.int().min(0), conflict: z.int().min(0), excluded: z.int().min(0),
});

export const HindsightCutoverStatusSchema = z.strictObject({
  runId: CutoverId,
  setupRevision: z.int().min(0),
  phase: CutoverPhase,
  status: CutoverStatus,
  expectedPredecessorEpochId: CutoverId,
  lease: z.strictObject({ active: z.boolean(), fence: z.int().min(0), expiresAt: Timestamp.nullable() }),
  sourceCount: z.int().min(0).nullable(),
  factMappingCount: z.int().min(0),
  checkpointCount: z.int().min(0),
  localCoverage: HindsightLocalCoverageStatusSchema.optional(),
  currentState: HindsightCurrentStatusSchema.optional(),
  operationCounts: HindsightCutoverOperationCountsSchema,
  authority: z.strictObject({ mode: z.enum(["legacy-markdown", "canonical-local", "hindsight"]), epochId: CutoverId.nullable() }),
  updatedAt: Timestamp,
});
export type HindsightCutoverStatus = z.infer<typeof HindsightCutoverStatusSchema>;

export const HindsightCutoverVerifyResultSchema = z.strictObject({
  runId: CutoverId,
  expectedRevision: z.int().min(0),
  expectedEpochId: CutoverId,
  eligible: z.boolean(),
  blockingCodes: z.array(z.string().min(1).max(96)).max(32),
  status: HindsightCutoverStatusSchema,
});
export type HindsightCutoverVerifyResult = z.infer<typeof HindsightCutoverVerifyResultSchema>;

export const HindsightImportStatusSchema = z.enum([
  "pending", "submitted", "processing", "completed", "mapped", "failed", "cancelled", "conflict", "excluded",
]);
export type HindsightImportStatus = z.infer<typeof HindsightImportStatusSchema>;
export const HindsightOperationStatusSchema = z.enum(["pending", "processing", "completed", "failed", "cancelled", "not_found"]);
export type HindsightOperationStatus = z.infer<typeof HindsightOperationStatusSchema>;

export const HindsightImportLedgerSchema = z.strictObject({
  runId: Id,
  sourceId: Id,
  bankId: Id,
  documentId: Id,
  operationId: Id,
  contentIdentity: ContentIdentity,
  providerContentHash: Hash,
  attemptNo: z.int().min(1),
  status: HindsightImportStatusSchema,
  operationResultHash: Hash.nullable(),
  derivedUnitCount: z.int().min(0).nullable(),
  extractionErrorCount: z.int().min(0).nullable(),
  mappingComplete: z.boolean(),
  zeroFactAllowed: z.boolean(),
  updatedAt: Timestamp,
});
export type HindsightImportLedger = z.infer<typeof HindsightImportLedgerSchema>;

export const HindsightFactMappingSchema = z.strictObject({
  factId: Id,
  revision: z.int().min(1),
  payloadHash: Hash,
  ordinal: z.int().min(0),
});
export type HindsightFactMapping = z.infer<typeof HindsightFactMappingSchema>;

export const HindsightRetainRequestSchema = z.strictObject({
  content: z.string().min(1).max(100_000),
  documentId: Id,
  operationId: Id,
  context: z.string().max(16_384).nullable(),
  contentIdentity: ContentIdentity,
  providerContentHash: Hash,
});
export type HindsightRetainRequest = z.infer<typeof HindsightRetainRequestSchema>;

export const HindsightRetainResultSchema = z.strictObject({ operationId: Id, itemsCount: z.int().min(1) });
export type HindsightRetainResult = z.infer<typeof HindsightRetainResultSchema>;

export const HindsightOperationResultSchema = z.strictObject({
  operationId: Id,
  status: HindsightOperationStatusSchema,
  resultMetadataHash: Hash.nullable(),
  derivedUnitCount: z.int().min(0).nullable(),
  extractionErrorCount: z.int().min(0).nullable(),
});
export type HindsightOperationResult = z.infer<typeof HindsightOperationResultSchema>;

export const HindsightDocumentProjectionSchema = z.strictObject({
  bankId: Id,
  documentId: Id,
  contentHash: Hash.nullable(),
  memoryUnitCount: z.int().min(0),
});
export type HindsightDocumentProjection = z.infer<typeof HindsightDocumentProjectionSchema>;

export const HindsightReplicaCheckpointSchema = z.strictObject({
  providerLineage: z.string().uuid(),
  bankId: Id,
  bankGeneration: z.string().uuid(),
  replicaEpochId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  endCursor: z.int().min(0),
  manifestDigest: Hash,
  capturedAt: Timestamp,
  snapshotExpiresAt: Timestamp,
  publishedAt: Timestamp,
}).refine((value) => Date.parse(value.snapshotExpiresAt) > Date.parse(value.capturedAt), "checkpoint snapshot expiry must follow capture");
export type HindsightReplicaCheckpoint = z.infer<typeof HindsightReplicaCheckpointSchema>;

const JsonLeaf = z.union([z.string().max(100_000), z.number().finite(), z.boolean(), z.null()]);
function boundedJson(depth: number): z.ZodType<unknown> {
  if (depth === 0) return JsonLeaf;
  const item = boundedJson(depth - 1);
  return z.union([
    JsonLeaf,
    z.array(item).max(256),
    z.record(z.string().min(1).max(128), item).refine((value) => Object.keys(value).length <= 128),
  ]);
}
const BoundedJsonObject = z.record(z.string().min(1).max(128), boundedJson(4))
  .refine((value) => Object.keys(value).length <= 128);

export const HindsightFactProjectionSchema = z.strictObject({
  factId: Id,
  documentId: Id.nullable(),
  revision: z.int().min(1),
  payload: BoundedJsonObject,
});
export type HindsightFactProjection = z.infer<typeof HindsightFactProjectionSchema>;

export const HindsightFactPageSchema = z.strictObject({
  items: z.array(HindsightFactProjectionSchema).max(100),
  total: z.int().min(0),
  limit: z.int().min(1).max(100),
  offset: z.int().min(0),
});
export type HindsightFactPage = z.infer<typeof HindsightFactPageSchema>;

const Tags = z.array(z.string().min(1).max(256)).max(256);
const ObservationScopes = z.union([
  z.string().max(4096),
  z.array(z.array(z.string().min(1).max(256)).max(64)).max(64),
]).nullable();

export const HindsightLogicalObjectKindSchema = z.enum([
  "bank", "document", "memory_unit", "mental_model", "directive",
]);
export type HindsightLogicalObjectKind = z.infer<typeof HindsightLogicalObjectKindSchema>;

const HindsightSnapshotBankPayloadSchema = z.strictObject({
  bankId: Id, name: z.string().min(1).max(512),
  disposition: z.strictObject({ skepticism: z.int().min(1).max(5), literalism: z.int().min(1).max(5), empathy: z.int().min(1).max(5) }),
  mission: z.string().max(16_384), config: HindsightLogicalJsonObjectSchema, createdAt: Timestamp, updatedAt: Timestamp,
});
const HindsightSnapshotDocumentPayloadSchema = z.strictObject({
  documentId: Id, bankId: Id, contentHash: z.string().max(256).nullable(), tags: Tags, metadata: HindsightLogicalJsonObjectSchema,
  observationScopes: ObservationScopes, createdAt: Timestamp, updatedAt: Timestamp,
});
const HindsightSnapshotMemoryPayloadSchema = z.strictObject({
  memoryId: Id, bankId: Id, documentId: Id.nullable(), chunkId: Id.nullable(), text: z.string().min(1).max(100_000),
  context: z.string().max(16_384).nullable(), factType: z.string().min(1).max(64), state: z.enum(["valid", "invalidated"]),
  revision: z.int().min(1), tags: Tags, metadata: HindsightLogicalJsonObjectSchema, entities: Tags, sourceMemoryIds: z.array(Id).max(256),
  observationScopes: ObservationScopes, eventDate: Timestamp.nullable(), occurredStart: Timestamp.nullable(),
  occurredEnd: Timestamp.nullable(), mentionedAt: Timestamp.nullable(), createdAt: Timestamp, updatedAt: Timestamp,
  editedAt: Timestamp.nullable(), consolidatedAt: Timestamp.nullable(), consolidationFailedAt: Timestamp.nullable(),
  invalidationReason: z.string().max(2048).nullable(), invalidatedAt: Timestamp.nullable(), proofCount: z.int().min(1),
});
const HindsightSnapshotMentalModelPayloadSchema = z.strictObject({
  mentalModelId: Id, bankId: Id, subtype: z.string().min(1).max(128), name: z.string().min(1).max(512),
  sourceQuery: z.string().max(16_384).nullable(), content: z.string().max(100_000).nullable(), tags: Tags,
  maxTokens: z.int().min(1).nullable(), trigger: HindsightLogicalJsonObjectSchema.nullable(), lastRefreshedAt: Timestamp.nullable(),
  createdAt: Timestamp, reflectResponse: HindsightLogicalJsonObjectSchema.nullable(), structuredContent: HindsightLogicalJsonObjectSchema.nullable(),
});
const HindsightSnapshotDirectivePayloadSchema = z.strictObject({
  directiveId: Id, bankId: Id, name: z.string().min(1).max(512), content: z.string().max(100_000),
  priority: z.int(), isActive: z.boolean(), tags: Tags, createdAt: Timestamp, updatedAt: Timestamp,
});
export const HindsightLogicalPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bank"), value: HindsightSnapshotBankPayloadSchema }),
  z.strictObject({ kind: z.literal("document"), value: HindsightSnapshotDocumentPayloadSchema }),
  z.strictObject({ kind: z.literal("memory_unit"), value: HindsightSnapshotMemoryPayloadSchema }),
  z.strictObject({ kind: z.literal("mental_model"), value: HindsightSnapshotMentalModelPayloadSchema }),
  z.strictObject({ kind: z.literal("directive"), value: HindsightSnapshotDirectivePayloadSchema }),
]);
export type HindsightLogicalPayload = z.infer<typeof HindsightLogicalPayloadSchema>;

export const HindsightLogicalSnapshotRecordSchema = z.strictObject({
  objectKind: HindsightLogicalObjectKindSchema, objectId: Id, objectRevision: z.int().min(1),
  payload: HindsightLogicalPayloadSchema,
}).superRefine((record, context) => {
  if (record.objectKind !== record.payload.kind) context.addIssue({ code: "custom", message: "payload kind mismatch" });
  const value = record.payload.value;
  const identity = record.objectKind === "bank" && "bankId" in value ? value.bankId
    : record.objectKind === "document" && "documentId" in value ? value.documentId
      : record.objectKind === "memory_unit" && "memoryId" in value ? value.memoryId
        : record.objectKind === "mental_model" && "mentalModelId" in value ? value.mentalModelId
          : record.objectKind === "directive" && "directiveId" in value ? value.directiveId : "";
  if (identity !== record.objectId) context.addIssue({ code: "custom", message: "payload identity mismatch" });
  if (record.objectKind === "memory_unit" && "revision" in value && record.objectRevision !== value.revision) {
    context.addIssue({ code: "custom", message: "payload revision mismatch" });
  }
});
export type HindsightLogicalSnapshotRecord = z.infer<typeof HindsightLogicalSnapshotRecordSchema>;

export const HindsightLogicalSnapshotCountsSchema = z.strictObject({
  bank: z.int().min(0), document: z.int().min(0),
  memoryUnit: z.strictObject({ valid: z.int().min(0), invalidated: z.int().min(0) }),
  mentalModel: z.int().min(0), directive: z.int().min(0), total: z.int().min(1),
}).refine((counts) => counts.total === counts.bank + counts.document + counts.memoryUnit.valid
  + counts.memoryUnit.invalidated + counts.mentalModel + counts.directive, "composed count mismatch");
export type HindsightLogicalSnapshotCounts = z.infer<typeof HindsightLogicalSnapshotCountsSchema>;

export const HindsightLogicalSnapshotManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), bankId: Id, providerLineage: z.string().uuid(), bankGeneration: z.string().uuid(),
  endCursor: z.int().min(0), pageSize: z.int().min(1).max(1000), totalPages: z.int().min(1),
  totalRecords: z.int().min(1), counts: HindsightLogicalSnapshotCountsSchema,
  pageHashes: z.array(Hash).min(1).max(100_000), manifestDigest: Hash,
}).superRefine((manifest, context) => {
  if (manifest.totalRecords !== manifest.counts.total) context.addIssue({ code: "custom", message: "record count mismatch" });
  if (manifest.pageHashes.length !== manifest.totalPages) context.addIssue({ code: "custom", message: "page hash count mismatch" });
});
export type HindsightLogicalSnapshotManifest = z.infer<typeof HindsightLogicalSnapshotManifestSchema>;

export const HindsightLogicalSnapshotMetadataSchema = z.strictObject({
  snapshotId: z.string().uuid(), manifest: HindsightLogicalSnapshotManifestSchema,
  createdAt: Timestamp, expiresAt: Timestamp,
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.createdAt), "snapshot expiry must follow creation");
export type HindsightLogicalSnapshotMetadata = z.infer<typeof HindsightLogicalSnapshotMetadataSchema>;

export const HindsightLogicalSnapshotPageSchema = z.strictObject({
  snapshotId: z.string().uuid(), pageNumber: z.int().min(0), totalPages: z.int().min(1),
  recordCount: z.int().min(1).max(1000), contentHash: Hash,
  records: z.array(HindsightLogicalSnapshotRecordSchema).min(1).max(1000),
}).refine((page) => page.recordCount === page.records.length, "page record count mismatch");
export type HindsightLogicalSnapshotPage = z.infer<typeof HindsightLogicalSnapshotPageSchema>;

export const HindsightAuthorityActivationSchema = z.strictObject({
  predecessorEpochId: Id,
  hindsightEpochId: Id,
  providerLineage: z.string().uuid(),
  snapshotId: Id,
  manifestDigest: Hash,
  transactionId: Id,
  committedAt: Timestamp,
});
export type HindsightAuthorityActivation = z.infer<typeof HindsightAuthorityActivationSchema>;
