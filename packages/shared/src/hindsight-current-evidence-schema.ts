/**
 * INPUT:  complete Local capture identities and frozen native structured-transfer commands
 * OUTPUT: durable D78 preparation and verified import evidence contracts
 * POS:    shared migration evidence — no B2 foreign keys or source-evidence-v1 reinterpretation
 */
import { z } from "zod";
import { MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";
import { HindsightCurrentTransferRequestSchema, HindsightCurrentTransferResultSchema,
  HindsightCurrentMappingPageSchema, HindsightCurrentMappingSchema } from "./hindsight-current-state-schema.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().min(1).max(256);
export const HindsightCurrentPreparationGapSchema = z.strictObject({
  code: z.enum(["chunk_evidence_unavailable", "missing_source", "native_record_limit", "native_request_bytes", "native_value",
    "native_text_nul", "native_json_depth", "native_model_subtype"]),
  objectKind: z.enum(["bank", "document", "memory_unit", "mental_model", "directive"]), objectId: Id,
});
export type HindsightCurrentPreparationGap = z.infer<typeof HindsightCurrentPreparationGapSchema>;
export const HindsightPreparedCurrentBankSchema = z.strictObject({
  schemaVersion: z.literal(1), preparationId: Hash, captureId: Hash,
  runId: Id, manifestId: Id, localManifestDigest: Hash, localEpochId: Id,
  sourceBankId: Id, bankId: Id, bankScope: MemoryBankScopeSchema, templateDigest: Hash,
  operationId: z.uuid(), request: HindsightCurrentTransferRequestSchema.nullable(),
  gaps: z.array(HindsightCurrentPreparationGapSchema),
}).superRefine((value, context) => {
  if ((value.gaps.length === 0) !== (value.request !== null)) context.addIssue({ code: "custom", message: "request/gaps disagree" });
  if (value.request && (value.request.operation_id !== value.operationId
    || value.request.local_manifest_digest !== value.localManifestDigest || value.request.source_bank.source_id !== value.sourceBankId)) {
    context.addIssue({ code: "custom", message: "prepared request identity mismatch" });
  }
});
export type HindsightPreparedCurrentBank = z.infer<typeof HindsightPreparedCurrentBankSchema>;
export const HindsightCurrentImportEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1), evidenceId: Hash, preparationId: Hash,
  result: HindsightCurrentTransferResultSchema, pages: z.array(HindsightCurrentMappingPageSchema),
  mappings: z.array(HindsightCurrentMappingSchema),
});
export type HindsightCurrentImportEvidence = z.infer<typeof HindsightCurrentImportEvidenceSchema>;
