/**
 * INPUT:  complete writer-reserved Local captures and identity-bound native transition evidence
 * OUTPUT: lossless immutable candidate, mapping and common-baseline storage contracts
 * POS:    shared transition protocol — preparation only; authority publication belongs to Core COMMIT
 */
import { z } from "zod";
import { HindsightCurrentCanonicalBankSchema, HindsightCurrentCanonicalSourceSchema,
  HindsightCurrentCanonicalRecordSchema, HindsightCurrentCanonicalDerivedSchema } from "./hindsight-current-canonical-schema.ts";
import { HindsightCurrentDispositionSchema } from "./hindsight-current-capture-schema.ts";
import { HindsightLocalCoverageRecordSchema } from "./hindsight-local-coverage-schema.ts";
import { MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";
import { TakiApplicationBlockBodySchema } from "./hindsight-application-artifact-schema.ts";
import { TakiApplicationBodyRefSchema, TakiApplicationNativeVersionSchema,
  TakiApplicationArtifactVersionSchema, TakiApplicationNativeTombstoneSchema } from "./hindsight-application-primitives-schema.ts";
import { TakiApplicationRecordPageSchema } from "./hindsight-application-read-schema.ts";
import { HindsightSnapshotPageWireSchema } from "./hindsight-native-snapshot-schema.ts";
import { HindsightCutoverEvidencePageSchema } from "./hindsight-cutover-verification-schema.ts";
import { HindsightTransitionStatusSchema, HindsightTransitionAuxiliaryPageSchema } from "./hindsight-transition-schema.ts";
import { MemoryTransitionSourceAliasSchema, MemoryTransitionSourceSetSchema, MemoryTransitionPendingSourceSchema } from "./memory-transition-source-schema.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().min(1).max(256);
const Time = z.iso.datetime({ offset: true });
export const MemoryTransitionHistoryRowSchema = z.strictObject({ table: Id, rowJson: z.string() });
export const MemoryTransitionHistoricalReferenceSchema = z.strictObject({
  bankId: Id, memoryId: Id, sourceMemoryId: Id, evidenceId: Hash, proofHash: Hash,
  referrer: TakiApplicationNativeVersionSchema, previous: TakiApplicationNativeVersionSchema,
  tombstone: TakiApplicationNativeTombstoneSchema,
}).superRefine((value, context) => {
  if (value.memoryId === value.sourceMemoryId || value.referrer.object_kind !== "memory_unit"
    || value.previous.object_kind !== "memory_unit" || value.tombstone.object_kind !== "memory_unit"
    || value.previous.object_id !== value.tombstone.object_id
    || value.previous.object_revision !== value.tombstone.object_revision
    || value.previous.payload_hash !== value.tombstone.last_payload_hash
    || (value.previous.native_cursor ?? -1) >= value.tombstone.native_cursor) {
    context.addIssue({ code: "custom", message: "historical reference identity mismatch" });
  }
});
export type MemoryTransitionHistoricalReference = z.infer<typeof MemoryTransitionHistoricalReferenceSchema>;
export const MemoryTransitionLocalStateSchema = z.strictObject({
  banks: z.array(HindsightCurrentCanonicalBankSchema), sources: z.array(HindsightCurrentCanonicalSourceSchema),
  records: z.array(HindsightCurrentCanonicalRecordSchema), derived: z.array(HindsightCurrentCanonicalDerivedSchema),
  blocks: z.array(TakiApplicationBlockBodySchema), history: z.array(MemoryTransitionHistoryRowSchema),
  historicalReferences: z.array(MemoryTransitionHistoricalReferenceSchema).default([]),
  sourceAliases: z.array(MemoryTransitionSourceAliasSchema).default([]), sourceSets: z.array(MemoryTransitionSourceSetSchema).default([]),
}).superRefine((value, context) => {
  const scopes = value.banks.map((bank) => JSON.stringify(bank.scope));
  if (new Set(scopes).size !== scopes.length || new Set(value.banks.map((bank) => bank.bankId)).size !== value.banks.length) {
    context.addIssue({ code: "custom", message: "Local inventory must have unique scopes and Bank identities" });
  }
  const objects = [...value.sources.map((row) => ["source", row.bankId, row.documentId]),
    ...value.records.map(({ unit }) => ["memory", unit.bankId, unit.memoryId]),
    ...value.derived.map((row) => [row.payload.kind, row.bankId, row.payload.kind === "mental_model" ? row.payload.mentalModelId : row.payload.directiveId]),
    ...value.blocks.map((row) => ["block", JSON.stringify(row.scope), row.block_id])].map((key) => JSON.stringify(key));
  if (new Set(objects).size !== objects.length) context.addIssue({ code: "custom", message: "duplicate Local logical object" });
});
export type MemoryTransitionLocalState = z.infer<typeof MemoryTransitionLocalStateSchema>;
export const MemoryTransitionLocalCaptureSchema = z.strictObject({ version: z.literal(1), captureId: Hash,
  transitionId: z.uuid(), epochId: Id, capturedAt: Time, contentHash: Hash, inventoryHash: Hash,
  witnesses: z.array(HindsightLocalCoverageRecordSchema), dispositions: z.array(HindsightCurrentDispositionSchema),
  state: MemoryTransitionLocalStateSchema,
}).superRefine((value, context) => {
  if (value.witnesses.length !== value.dispositions.length || value.witnesses.some((row, i) => row.key !== value.dispositions[i]?.witness.key)
    || value.state.banks.some((bank) => bank.authorityEpochId !== value.epochId)) context.addIssue({ code: "custom", message: "capture closure mismatch" });
});
export type MemoryTransitionLocalCapture = z.infer<typeof MemoryTransitionLocalCaptureSchema>;
export const MemoryTransitionNativeEvidenceSchema = z.strictObject({ version: z.literal(1), evidenceId: Hash,
  transitionId: z.uuid(), status: HindsightTransitionStatusSchema,
  nativePages: z.array(HindsightSnapshotPageWireSchema), applicationPages: z.array(TakiApplicationRecordPageSchema),
  bodies: z.array(z.strictObject({ ref: TakiApplicationBodyRefSchema, base64: z.string() })),
  maintenancePages: z.array(HindsightCutoverEvidencePageSchema), auxiliaryPages: z.array(HindsightTransitionAuxiliaryPageSchema),
}).superRefine((value, context) => {
  if (value.transitionId !== value.status.request.transition_id || new Set(value.bodies.map((body) => body.ref.body_id)).size !== value.bodies.length) {
    context.addIssue({ code: "custom", message: "native evidence identity or duplicate body mismatch" });
  }
});
export type MemoryTransitionNativeEvidence = z.infer<typeof MemoryTransitionNativeEvidenceSchema>;
export const MemoryTransitionScopeMappingSchema = z.strictObject({ scope: MemoryBankScopeSchema, localBankId: Id,
  nativeBankId: Id, nativeGeneration: z.uuid(), evidenceId: Hash,
  origin: z.enum(["original", "baseline", "new"]), originEpochId: Id.nullable(),
});
export type MemoryTransitionScopeMapping = z.infer<typeof MemoryTransitionScopeMappingSchema>;
export const MemoryTransitionObjectMappingSchema = z.strictObject({ localBankId: Id,
  kind: z.enum(["bank", "document", "memory_unit", "mental_model", "directive"]), localId: Id,
  native: TakiApplicationNativeVersionSchema, semanticHash: Hash,
  application: TakiApplicationArtifactVersionSchema.nullable(), applicationBodyHash: Hash.nullable(),
  origin: z.enum(["original", "baseline", "native-derived"]),
});
export type MemoryTransitionObjectMapping = z.infer<typeof MemoryTransitionObjectMappingSchema>;
export const MemoryTransitionCandidateSchema = z.strictObject({ version: z.literal(1), candidateId: Hash,
  transitionId: z.uuid(), predecessorEpochId: Id, targetEpochId: z.uuid(), createdAt: Time,
  localCaptureId: Hash.nullable(), evidenceIds: z.array(Hash).min(1),
  scopes: z.array(MemoryTransitionScopeMappingSchema).min(1), mappings: z.array(MemoryTransitionObjectMappingSchema),
  state: MemoryTransitionLocalStateSchema, pendingSources: z.array(MemoryTransitionPendingSourceSchema), mappingHash: Hash, stateHash: Hash,
}).superRefine((value, context) => {
  const objects = [...value.state.banks, ...value.state.sources, ...value.state.derived, ...value.state.records.map((record) => record.unit)];
  if (objects.some((row) => row.authorityEpochId !== value.targetEpochId) || value.targetEpochId === value.predecessorEpochId
    || value.evidenceIds.length !== new Set(value.evidenceIds).size || value.scopes.length !== value.evidenceIds.length
    || JSON.stringify(value.scopes.map((row) => row.localBankId).sort()) !== JSON.stringify(value.state.banks.map((row) => row.bankId).sort())) {
    context.addIssue({ code: "custom", message: "candidate target or inventory mismatch" });
  }
});
export type MemoryTransitionCandidate = z.infer<typeof MemoryTransitionCandidateSchema>;
export const MemoryTransitionCommonBaselineSchema = z.strictObject({ version: z.literal(1), baselineId: Hash,
  transitionId: z.uuid(), candidateId: Hash, predecessorBaselineId: Hash.nullable(), providerLineageId: z.uuid(),
  targetEpochId: Id, evidenceIds: z.array(Hash).min(1), mappingHash: Hash, stateHash: Hash,
});
export type MemoryTransitionCommonBaseline = z.infer<typeof MemoryTransitionCommonBaselineSchema>;
