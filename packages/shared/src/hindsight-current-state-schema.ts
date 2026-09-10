/**
 * INPUT:  native current_state_schema.py version 1.0.0 structured transfer messages
 * OUTPUT: strict mirrored request, result, mapping and refusal contracts
 * POS:    shared memory wire — D78 protocol; existing retain/source-evidence codecs are unchanged
 */
import { z } from "zod";
import { HindsightCurrentJsonObjectSchema } from "./hindsight-current-canonical-schema.ts";

export const HINDSIGHT_CURRENT_STATE_BUILD = "taki-memory-hindsight-0.9.0-d78-v1";
export const HINDSIGHT_CURRENT_STATE_VERSION = "1.0.0";
export const HINDSIGHT_CURRENT_STATE_ENCODING = "taki-current-state/tagged-json-binary64-v1";
export const HINDSIGHT_CURRENT_STATE_MAX_RECORDS = 10_000;
export const HINDSIGHT_CURRENT_STATE_MAX_BYTES = 16 * 1024 * 1024;
export const HINDSIGHT_CURRENT_STATE_PAGE_SIZE = 128;
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Id = z.string().min(1).max(256);
const Revision = z.int().min(1);
const Cursor = z.int().min(0);
const Timestamp = z.iso.datetime({ offset: true });
const Tags = z.array(z.string());
const Metadata = HindsightCurrentJsonObjectSchema;
const Scopes = z.union([z.enum(["per_tag", "combined", "all_combinations", "shared"]), z.array(z.array(z.string()))]).nullable();
const Kind = z.enum(["bank", "document", "memory_unit", "mental_model", "directive"]);

export const HindsightCurrentSourceWitnessSchema = z.strictObject({
  source_kind: Kind, source_id: Id, source_revision: Revision, source_payload_hash: Hash,
});
export type HindsightCurrentSourceWitness = z.infer<typeof HindsightCurrentSourceWitnessSchema>;
export const HindsightCurrentDocumentSchema = z.strictObject({
  source: HindsightCurrentSourceWitnessSchema, content_hash: z.string().max(256).nullable(),
  original_text: z.string().max(100_000).nullable(), context: z.string().max(16_384).nullable(),
  tags: Tags, metadata: Metadata, observation_scopes: Scopes, created_at: Timestamp, updated_at: Timestamp,
});
export const HindsightCurrentChunkSchema = z.strictObject({
  source_chunk_id: Id, source_document_id: Id, chunk_index: Cursor, chunk_text: z.string().max(100_000),
});
export const HindsightCurrentUnitSchema = z.strictObject({
  source: HindsightCurrentSourceWitnessSchema, document_id: Id.nullable(), chunk_id: Id.nullable(),
  text: z.string().min(1).max(100_000), context: z.string().max(16_384).nullable(),
  fact_type: z.enum(["world", "experience", "observation"]), state: z.enum(["valid", "invalidated"]),
  tags: Tags, metadata: Metadata, entities: Tags, source_memory_ids: z.array(Id), observation_scopes: Scopes,
  event_date: Timestamp.nullable(), occurred_start: Timestamp.nullable(), occurred_end: Timestamp.nullable(), mentioned_at: Timestamp.nullable(),
  created_at: Timestamp, updated_at: Timestamp, edited_at: Timestamp.nullable(), consolidated_at: Timestamp.nullable(),
  consolidation_failed_at: Timestamp.nullable(), invalidation_reason: z.string().max(512).nullable(),
  invalidated_at: Timestamp.nullable(), proof_count: Revision,
}).superRefine((value, context) => {
  if (value.state === "valid" && (value.invalidated_at !== null || value.invalidation_reason !== null)
    || value.state === "invalidated" && value.invalidated_at === null || value.source_memory_ids.includes(value.source.source_id)) {
    context.addIssue({ code: "custom", message: "invalid current unit lifecycle or self reference" });
  }
});
export type HindsightCurrentUnit = z.infer<typeof HindsightCurrentUnitSchema>;
export const HindsightCurrentMentalModelSchema = z.strictObject({
  source: HindsightCurrentSourceWitnessSchema, subtype: Id, name: z.string().min(1).max(256),
  source_query: z.string().max(16_384).nullable(), content: z.string().max(100_000).nullable(), tags: Tags,
  max_tokens: z.int().min(1).max(1_000_000).nullable(), trigger: Metadata.nullable(),
  last_refreshed_at: Timestamp.nullable(), created_at: Timestamp, reflect_response: Metadata.nullable(), structured_content: Metadata.nullable(),
});
export const HindsightCurrentDirectiveSchema = z.strictObject({
  source: HindsightCurrentSourceWitnessSchema, name: z.string().min(1).max(256), content: z.string().min(1).max(100_000),
  priority: z.int().min(0).max(100), is_active: z.boolean(), tags: Tags, created_at: Timestamp, updated_at: Timestamp,
});
export const HindsightCurrentSupersededObjectSchema = z.strictObject({
  object_kind: z.enum(["document", "memory_unit", "mental_model", "directive"]), object_id: Id,
  object_revision: Revision, payload_hash: Hash,
  ownership: z.strictObject({ receipt_kind: z.enum(["native_result", "current_state_transfer"]),
    operation_id: z.uuid(), request_hash: Hash, result_hash: Hash }),
});
const Version = { contract_version: z.literal(HINDSIGHT_CURRENT_STATE_VERSION), encoding: z.literal(HINDSIGHT_CURRENT_STATE_ENCODING) };
const Namespace = { operation_id: z.uuid(), provider_lineage: z.uuid(), bank_generation: z.uuid() };
export const HindsightCurrentTargetBankSchema = z.strictObject({
  object_kind: z.literal("bank"), object_id: Id, object_revision: Revision, payload_hash: Hash,
});
export const HindsightCurrentPreservedResourceSchema = z.strictObject({
  object_kind: z.enum(["mental_model", "directive"]), object_id: Id, object_revision: Revision, payload_hash: Hash,
});
export const HindsightCurrentTransferRequestSchema = z.strictObject({
  ...Version, ...Namespace, request_hash: Hash, local_manifest_digest: Hash, source_bank: HindsightCurrentSourceWitnessSchema,
  target_bank: HindsightCurrentTargetBankSchema, preserve: z.array(HindsightCurrentPreservedResourceSchema),
  documents: z.array(HindsightCurrentDocumentSchema), chunks: z.array(HindsightCurrentChunkSchema),
  memory_units: z.array(HindsightCurrentUnitSchema), mental_models: z.array(HindsightCurrentMentalModelSchema),
  directives: z.array(HindsightCurrentDirectiveSchema), supersede: z.array(HindsightCurrentSupersededObjectSchema),
});
export type HindsightCurrentTransferRequest = z.infer<typeof HindsightCurrentTransferRequestSchema>;
export const HindsightCurrentMappingSchema = z.strictObject({
  ordinal: Cursor, source: HindsightCurrentSourceWitnessSchema, target_kind: Kind, target_id: Id,
  target_revision: Revision, target_payload_hash: Hash, journal_cursor: Cursor.nullable(),
});
export type HindsightCurrentMapping = z.infer<typeof HindsightCurrentMappingSchema>;
export const HindsightCurrentTransferResultSchema = z.strictObject({
  ...Version, ...Namespace, state: z.literal("completed"), request_hash: Hash, local_manifest_digest: Hash,
  bank_id: Id, source_bank_id: Id, native_before_cursor: Cursor, native_through_cursor: Cursor,
  native_batch_id: z.uuid().nullable(), superseded_count: Cursor,
  manifest: z.strictObject({ total_records: z.int().min(1).max(HINDSIGHT_CURRENT_STATE_MAX_RECORDS),
    page_size: z.literal(HINDSIGHT_CURRENT_STATE_PAGE_SIZE), total_pages: z.int().min(1),
    mappings_hash: Hash, page_hashes: z.array(Hash) }), result_hash: Hash,
});
export type HindsightCurrentTransferResult = z.infer<typeof HindsightCurrentTransferResultSchema>;
export const HindsightCurrentMappingPageSchema = z.strictObject({
  ...Namespace, bank_id: Id, result_hash: Hash, page_number: Cursor, total_pages: z.int().min(1),
  page_hash: Hash, mappings: z.array(HindsightCurrentMappingSchema).max(HINDSIGHT_CURRENT_STATE_PAGE_SIZE),
});
export type HindsightCurrentMappingPage = z.infer<typeof HindsightCurrentMappingPageSchema>;
export const HindsightCurrentTransferFailureSchema = z.strictObject({
  error: z.literal("current_state_transfer_refused"), reason: z.enum([
    "invalid_request_hash", "duplicate_source", "source_kind_mismatch", "missing_source", "missing_chunk_evidence",
    "invalid_chunk_evidence", "unsupported_value", "bank_not_found", "generation_mismatch", "request_conflict",
    "target_conflict", "ownership_unproven", "ownership_drift", "request_too_large", "unsupported_storage",
    "result_not_found", "page_not_found", "receipt_corrupt", "operation_refused",
  ]),
});
export type HindsightCurrentTransferFailure = z.infer<typeof HindsightCurrentTransferFailureSchema>;
