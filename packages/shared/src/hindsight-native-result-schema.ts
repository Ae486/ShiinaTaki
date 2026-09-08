/**
 * INPUT:  tracked native commands and producer-owned immutable factual result pages
 * OUTPUT: canonical G1 wire models and compact durable confirmation receipts
 * POS:    shared memory protocol — distinct from legacy intent hashes and derived/cutover evidence
 */
import { z } from "zod";

export const HINDSIGHT_NATIVE_RESULT_VERSION = "1.0.0" as const;
export const HINDSIGHT_NATIVE_RESULT_BUILD = "taki-memory-hindsight-0.9.0-g1-v1" as const;
export const HINDSIGHT_NATIVE_RESULT_PAGE_SIZE = 128 as const;
const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const Natural = z.int().min(0);
const Identity = z.strictObject({
  contract_version: z.literal(HINDSIGHT_NATIVE_RESULT_VERSION), operation_id: z.uuid(),
  provider_lineage: z.uuid(), bank_generation: z.uuid(),
});
export const HindsightNativeIdentitySchema = Identity;
export type HindsightNativeIdentity = z.infer<typeof HindsightNativeIdentitySchema>;
export const HindsightNativeOperationKindSchema = z.enum(["retain", "mutation"]);
export type HindsightNativeOperationKind = z.infer<typeof HindsightNativeOperationKindSchema>;

export const HindsightNativeRetainItemSchema = z.strictObject({
  content: z.string().min(1), timestamp: z.string().nullable().optional(), context: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(), document_id: z.string().nullable().optional(),
  entities: z.array(z.strictObject({ text: z.string(), type: z.string().nullable().optional() })).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  observation_scopes: z.union([z.enum(["per_tag", "combined", "all_combinations", "shared"]), z.array(z.array(z.string()))]).nullable().optional(),
  strategy: z.string().nullable().optional(), update_mode: z.enum(["replace", "append"]).nullable().optional(),
});
export type HindsightNativeRetainItem = z.infer<typeof HindsightNativeRetainItemSchema>;
export const HindsightTrackedRetainRequestSchema = Identity.extend({
  items: z.array(HindsightNativeRetainItemSchema).min(1), document_tags: z.array(z.string()).nullable().optional(),
});
export type HindsightTrackedRetainRequest = z.infer<typeof HindsightTrackedRetainRequestSchema>;

export const HindsightNativeMutationSchema = z.strictObject({
  text: z.string().nullable().optional(), context: z.string().nullable().optional(),
  occurred_start: z.string().nullable().optional(), occurred_end: z.string().nullable().optional(),
  fact_type: z.enum(["world", "experience"]).nullable().optional(), entities: z.array(z.string()).nullable().optional(),
  state: z.enum(["valid", "invalidated"]).nullable().optional(), reason: z.string().nullable().optional(),
  expected_revision: z.int().min(1).nullable().optional(), mutation_id: z.uuid().nullable().optional(),
});
export type HindsightNativeMutation = z.infer<typeof HindsightNativeMutationSchema>;
export const HindsightTrackedMutationRequestSchema = Identity.extend({ mutation: HindsightNativeMutationSchema })
  .refine((value) => !value.mutation.mutation_id || value.mutation.mutation_id === value.operation_id, "tracked mutation identity disagrees");
export type HindsightTrackedMutationRequest = z.infer<typeof HindsightTrackedMutationRequestSchema>;

export const HindsightNativeReferenceSchema = z.strictObject({
  ordinal: Natural, input_index: Natural, document_id: z.string().nullable(), memory_id: z.uuid(),
  revision: z.int().min(1), state: z.enum(["valid", "invalidated"]),
});
export type HindsightNativeReference = z.infer<typeof HindsightNativeReferenceSchema>;
export const HindsightNativeInputResultSchema = z.strictObject({
  input_index: Natural, document_id: z.string(), update_mode: z.enum(["replace", "append"]),
  prepared_input_hash: Digest, document_hash: Digest, created_count: Natural, full_result_count: Natural, first_ordinal: Natural,
});
export type HindsightNativeInputResult = z.infer<typeof HindsightNativeInputResultSchema>;
export const HindsightNativeMutationResultSchema = z.strictObject({
  memory_id: z.uuid(), revision: z.int().min(1), state: z.enum(["valid", "invalidated"]),
  document_id: z.string().nullable(), chunk_id: z.string().nullable(),
});
export const HindsightNativeResultManifestSchema = z.strictObject({
  total_records: Natural, page_size: z.literal(HINDSIGHT_NATIVE_RESULT_PAGE_SIZE), total_pages: Natural, references_sha256: Digest,
}).refine((value) => value.total_pages === Math.ceil(value.total_records / value.page_size), "native manifest coverage disagrees");

export const HindsightNativeResultSchema = Identity.extend({
  bank_id: z.string().min(1), operation_kind: HindsightNativeOperationKindSchema, request_hash: Digest,
  native_outcome: z.enum(["applied", "unchanged"]), native_through_cursor: Natural,
  inputs: z.array(HindsightNativeInputResultSchema), mutation: HindsightNativeMutationResultSchema.nullable(),
  manifest: HindsightNativeResultManifestSchema, result_hash: Digest, native_receipt_hash: Digest,
}).superRefine((value, context) => {
  let ordinal = 0;
  for (const [index, input] of value.inputs.entries()) {
    if (input.input_index !== index || input.first_ordinal !== ordinal) context.addIssue({ code: "custom", message: "native input coverage disagrees" });
    ordinal += input.full_result_count;
  }
  if (ordinal !== value.manifest.total_records || (value.operation_kind === "mutation") !== (value.mutation !== null)
    || (value.operation_kind === "mutation" && value.inputs.length !== 0)
    || (value.operation_kind === "retain" && value.inputs.length === 0)) context.addIssue({ code: "custom", message: "native result kind or count disagrees" });
});
export type HindsightNativeResult = z.infer<typeof HindsightNativeResultSchema>;

export const HindsightNativeReceiptReasonSchema = z.enum([
  "request_conflict", "generation_mismatch", "legacy_operation_untracked", "receipt_not_found", "result_not_found",
  "task_cancelled", "task_missing", "stale_execution", "document_changed", "extraction_failed", "plan_incompatible",
  "receipt_corrupt", "target_not_found", "invalid_request",
]);
export const HindsightNativeResultStatusSchema = Identity.extend({
  bank_id: z.string().min(1), operation_kind: HindsightNativeOperationKindSchema, request_hash: Digest.nullable(),
  status: z.enum(["pending", "processing", "partial", "completed", "failed", "cancelled", "conflicting", "retired", "unavailable"]),
  reason: HindsightNativeReceiptReasonSchema.nullable().optional(),
  progress: z.strictObject({ expected_inputs: Natural, completed_inputs: Natural, committed_parts: Natural }).nullable(),
  result: HindsightNativeResultSchema.nullable(),
}).refine((value) => (value.status === "completed") === (value.result !== null), "native completion requires its immutable result");
export type HindsightNativeResultStatus = z.infer<typeof HindsightNativeResultStatusSchema>;
export const HindsightNativeResultPageSchema = Identity.extend({
  bank_id: z.string().min(1), operation_kind: HindsightNativeOperationKindSchema,
  result_hash: Digest, page_number: Natural, first_ordinal: Natural,
  references: z.array(HindsightNativeReferenceSchema).min(1).max(HINDSIGHT_NATIVE_RESULT_PAGE_SIZE), page_sha256: Digest,
});
export type HindsightNativeResultPage = z.infer<typeof HindsightNativeResultPageSchema>;
export const HindsightNativeResultErrorSchema = z.object({
  error: z.enum(["taki_native_result_refused", "memory_revision_mismatch", "memory_mutation_id_conflict"]),
  reason: HindsightNativeReceiptReasonSchema.optional(), memory_id: z.string().optional(),
  mutation_id: z.uuid().optional(), expected_revision: z.int().min(1).optional(), current_revision: z.int().min(1).optional(),
});
export const HindsightNativeWriteResponseSchema = z.union([HindsightNativeResultStatusSchema, HindsightNativeResultErrorSchema]);
export type HindsightNativeWriteResponse = z.infer<typeof HindsightNativeWriteResponseSchema>;

export const PendingMemoryDispatchProtocolSchema = z.enum(["legacy_native_v1", "tracked_native_v1"]);
export type PendingMemoryDispatchProtocol = z.infer<typeof PendingMemoryDispatchProtocolSchema>;
export const PendingMemoryDispatchSchema = z.discriminatedUnion("protocol", [
  z.strictObject({ protocol: z.literal("legacy_native_v1") }),
  z.strictObject({
    protocol: z.literal("tracked_native_v1"), requestHash: Digest,
    command: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("retain"), request: HindsightTrackedRetainRequestSchema }),
      z.strictObject({ kind: z.literal("mutation"), memoryId: z.uuid(), request: HindsightTrackedMutationRequestSchema }),
    ]),
  }),
]);
export type PendingMemoryDispatch = z.infer<typeof PendingMemoryDispatchSchema>;
export const PendingMemoryNativeResultReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), result: HindsightNativeResultSchema, verifiedAt: z.iso.datetime({ offset: true }),
});
export type PendingMemoryNativeResultReceipt = z.infer<typeof PendingMemoryNativeResultReceiptSchema>;
