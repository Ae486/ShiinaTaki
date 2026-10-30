/**
 * INPUT:  canonical Local sources/units and exact native result/snapshot evidence
 * OUTPUT: versioned source preparation, representation gaps, and immutable object binding contracts
 * POS:    shared memory contract — durable Taki provenance, separate from Pending Memory and replica caches
 */
import { z } from "zod";
import { CanonicalMemoryRecordSchema, CanonicalMemorySourceSchema, MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";
import { HindsightLogicalSnapshotMetadataSchema, HindsightLogicalSnapshotPageSchema } from "./hindsight-cutover-schema.ts";
import { HindsightJournalPageSchema } from "./hindsight-journal-schema.ts";
import { HindsightNativeResultPageSchema, HindsightNativeResultSchema, HindsightNativeRetainItemSchema,
  HindsightTrackedRetainRequestSchema } from "./hindsight-native-result-schema.ts";

export const HINDSIGHT_SOURCE_EVIDENCE_VERSION = 1 as const;
export const HINDSIGHT_SOURCE_GAP_LIMIT = 32 as const;
const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Revision = z.int().min(1);
const Cursor = z.int().min(0);
const Timestamp = z.iso.datetime({ offset: true });

export const HindsightSourcePreparationGapSchema = z.strictObject({
  code: z.enum(["source_text_missing", "source_text_empty", "native_metadata_keys", "native_metadata_value",
    "native_request_bytes", "native_unicode"]),
  objectKind: z.enum(["document", "memory_unit"]), objectId: Id,
});
export type HindsightSourcePreparationGap = z.infer<typeof HindsightSourcePreparationGapSchema>;

export const HindsightSourceUnitEvidenceSchema = z.strictObject({
  recordHash: Hash, record: CanonicalMemoryRecordSchema,
});
export type HindsightSourceUnitEvidence = z.infer<typeof HindsightSourceUnitEvidenceSchema>;

export const HindsightPreparedSourceSchema = z.strictObject({
  schemaVersion: z.literal(HINDSIGHT_SOURCE_EVIDENCE_VERSION), evidenceId: Hash,
  source: CanonicalMemorySourceSchema, sourceHash: Hash, retainedTextHash: Hash.nullable(),
  units: z.array(HindsightSourceUnitEvidenceSchema), nativeItem: HindsightNativeRetainItemSchema.nullable(),
  nativeItemHash: Hash.nullable(), gapCount: z.int().min(0),
  gaps: z.array(HindsightSourcePreparationGapSchema).max(HINDSIGHT_SOURCE_GAP_LIMIT),
}).superRefine((value, context) => {
  if ((value.gaps.length === 0) !== (value.nativeItem !== null)
    || value.gaps.length !== Math.min(value.gapCount, HINDSIGHT_SOURCE_GAP_LIMIT)
    || (value.nativeItem === null) !== (value.nativeItemHash === null)) {
    context.addIssue({ code: "custom", message: "preparation gap and native item disagree" });
  }
  let prior: string | undefined;
  for (const { record } of value.units) {
    const unit = record.unit;
    if (unit.authorityEpochId !== value.source.authorityEpochId || unit.bankId !== value.source.bankId
      || unit.documentId !== value.source.documentId || (prior !== undefined && unit.memoryId <= prior)) {
      context.addIssue({ code: "custom", message: "source evidence unit scope or ordering disagrees" });
    }
    prior = unit.memoryId;
  }
  for (const gap of value.gaps) {
    if (gap.objectKind === "document" ? gap.objectId !== value.source.documentId
      : !value.units.some(({ record }) => record.unit.memoryId === gap.objectId)) {
      context.addIssue({ code: "custom", message: "preparation gap is outside its source" });
    }
  }
});
export type HindsightPreparedSource = z.infer<typeof HindsightPreparedSourceSchema>;

export const HindsightSourceProjectionScopeSchema = z.strictObject({
  authorityEpochId: Id, providerLineageId: z.uuid(), bankGeneration: z.uuid(),
  bank: z.strictObject({ bankId: Id, scope: MemoryBankScopeSchema }),
});
export type HindsightSourceProjectionScope = z.infer<typeof HindsightSourceProjectionScopeSchema>;

export const HindsightSourceBankBindingSchema = z.strictObject({
  sourceBankId: Id, nativeBankId: Id, scope: MemoryBankScopeSchema,
});
export type HindsightSourceBankBinding = z.infer<typeof HindsightSourceBankBindingSchema>;

export const HindsightSourceBindingKeySchema = z.strictObject({
  providerLineageId: z.uuid(), bankGeneration: z.uuid(), bankId: Id,
  objectKind: z.enum(["document", "memory_unit"]), objectId: Id, objectRevision: Revision,
});
export type HindsightSourceBindingKey = z.infer<typeof HindsightSourceBindingKeySchema>;

export const HindsightSourceObjectBindingSchema = HindsightSourceBindingKeySchema.extend({
  schemaVersion: z.literal(HINDSIGHT_SOURCE_EVIDENCE_VERSION), bindingId: Hash, evidenceId: Hash,
  sourceBankId: Id, bankScope: MemoryBankScopeSchema, sourceDocumentId: Id, sourceMemoryId: Id.nullable(), nativePayloadHash: Hash,
  operationId: z.uuid(), requestHash: Hash, resultHash: Hash, nativeReceiptHash: Hash,
  nativeThroughCursor: Cursor, observationKind: z.enum(["snapshot", "journal"]), observationId: z.uuid(),
  observedCursor: Cursor, confirmedAt: Timestamp,
}).superRefine((value, context) => {
  if (value.objectKind === "document" ? value.sourceMemoryId !== null || value.objectId !== value.sourceDocumentId
    : value.sourceMemoryId === null) context.addIssue({ code: "custom", message: "binding source identity disagrees" });
  if (value.observedCursor < value.nativeThroughCursor) context.addIssue({ code: "custom", message: "observation precedes native result" });
});
export type HindsightSourceObjectBinding = z.infer<typeof HindsightSourceObjectBindingSchema>;

export const HindsightSourceConfirmationSchema = z.strictObject({
  evidenceId: Hash, request: HindsightTrackedRetainRequestSchema, result: HindsightNativeResultSchema,
  resultPages: z.array(HindsightNativeResultPageSchema),
  observation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("snapshot"), metadata: HindsightLogicalSnapshotMetadataSchema,
      pages: z.array(HindsightLogicalSnapshotPageSchema) }),
    z.strictObject({ kind: z.literal("journal"), page: HindsightJournalPageSchema }),
  ]),
  unitAssociations: z.array(z.strictObject({ sourceMemoryId: Id, nativeMemoryId: z.uuid() })),
  confirmedAt: Timestamp,
}).superRefine((value, context) => {
  const sourceIds = new Set<string>(); const nativeIds = new Set<string>();
  for (const association of value.unitAssociations) {
    const nativeId = association.nativeMemoryId.toLowerCase();
    if (sourceIds.has(association.sourceMemoryId) || nativeIds.has(nativeId)) {
      context.addIssue({ code: "custom", message: "unit associations must be explicit and one to one" });
    }
    sourceIds.add(association.sourceMemoryId); nativeIds.add(nativeId);
  }
});
export type HindsightSourceConfirmation = z.infer<typeof HindsightSourceConfirmationSchema>;
