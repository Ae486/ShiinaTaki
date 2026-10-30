/**
 * INPUT:  admitted D77 Hindsight results and complete verified native write receipts
 * OUTPUT: versioned consumer validators that preserve supported JSON and all factual result references
 * POS:    shared Hindsight consumer adapter — frozen Canonical, Pending, G1 and D78 contracts stay unchanged
 */
import { z } from "zod";
import { MemoryErrorEnvelopeSchema, MemorySuccessEnvelopeSchema } from "./memory-provider-envelope-schema.ts";
import {
  MutationResultSchema, RecallPendingMutationOverlayEntrySchema, RecallPendingOverlayEntrySchema,
  RecallResultSchema, ReflectResultSchema, RetainBankProgressSchema, RetainCompletedResultSchema, RetainRequestSchema, RetainResultSchema,
} from "./memory-provider-operation-schema.ts";
import { HindsightCurrentCanonicalRecordSchema, HindsightCurrentJsonObjectSchema } from "./hindsight-current-canonical-schema.ts";
import { TakiApplicationJsonObjectSchema } from "./hindsight-application-json.ts";

// safeExtend retains the existing Bank/epoch/revision, returned count, partial/error and target-evidence
// refinements. Only read-side JSON validators change; this does not widen durable Pending admission.
const PendingRetain = RecallPendingOverlayEntrySchema.shape.operation.options[0].safeExtend({
  request: RetainRequestSchema.safeExtend({ metadata: HindsightCurrentJsonObjectSchema }),
});
const Pending = RecallPendingOverlayEntrySchema.safeExtend({
  operation: z.discriminatedUnion("kind", [PendingRetain, RecallPendingOverlayEntrySchema.shape.operation.options[1]]),
  targetRecord: HindsightCurrentCanonicalRecordSchema.optional(),
});
const PendingMutation = RecallPendingMutationOverlayEntrySchema.safeExtend({ targetRecord: HindsightCurrentCanonicalRecordSchema.optional() });
const Hit = RecallResultSchema.shape.hits.element.safeExtend({ record: HindsightCurrentCanonicalRecordSchema });
export const HindsightMemoryRecallResultV1Schema = RecallResultSchema.safeExtend({
  hits: z.array(Hit).max(100), pending: z.array(Pending).max(100).optional(),
});
export const HindsightMemoryReflectResultV1Schema = ReflectResultSchema.safeExtend({
  structuredContent: TakiApplicationJsonObjectSchema.nullable(), trace: TakiApplicationJsonObjectSchema.nullable(),
});
export const HindsightMemoryMutationResultV1Schema = z.union([
  MutationResultSchema.options[0].safeExtend({ record: HindsightCurrentCanonicalRecordSchema }),
  MutationResultSchema.options[1].safeExtend({ record: HindsightCurrentCanonicalRecordSchema.nullable() }),
  MutationResultSchema.options[2],
  MutationResultSchema.options[3].safeExtend({ pending: PendingMutation }),
]);

// G1 bounds each page, not the total number of factual references. A consumer must return the complete
// verified result; removing the Local array cap is neither an empty/zero receipt nor a new native protocol.
const BankProgress = RetainBankProgressSchema.safeExtend({ memoryCount: z.int().min(0) });
const CompletedMemories = z.array(RetainCompletedResultSchema.shape.memories.element);
export const HindsightMemoryRetainCompletedResultV1Schema = RetainCompletedResultSchema.safeExtend({
  memories: CompletedMemories, bankProgress: z.array(BankProgress).max(2).optional(),
});
export const HindsightMemoryRetainResultV1Schema = z.union([
  HindsightMemoryRetainCompletedResultV1Schema,
  RetainResultSchema.options[1].safeExtend({ memories: CompletedMemories, bankProgress: z.array(BankProgress).max(2).optional() }),
]);

export const HindsightMemoryRecallEnvelopeV1Schema = z.union([MemorySuccessEnvelopeSchema(HindsightMemoryRecallResultV1Schema), MemoryErrorEnvelopeSchema]);
export const HindsightMemoryReflectEnvelopeV1Schema = z.union([MemorySuccessEnvelopeSchema(HindsightMemoryReflectResultV1Schema), MemoryErrorEnvelopeSchema]);
export const HindsightMemoryMutationEnvelopeV1Schema = z.union([MemorySuccessEnvelopeSchema(HindsightMemoryMutationResultV1Schema), MemoryErrorEnvelopeSchema]);
export const HindsightMemoryRetainEnvelopeV1Schema = z.union([MemorySuccessEnvelopeSchema(HindsightMemoryRetainResultV1Schema), MemoryErrorEnvelopeSchema]);
export type HindsightMemoryRecallResultV1 = z.infer<typeof HindsightMemoryRecallResultV1Schema>;
export type HindsightMemoryReflectResultV1 = z.infer<typeof HindsightMemoryReflectResultV1Schema>;
export type HindsightMemoryMutationResultV1 = z.infer<typeof HindsightMemoryMutationResultV1Schema>;
export type HindsightMemoryRetainResultV1 = z.infer<typeof HindsightMemoryRetainResultV1Schema>;
export type HindsightMemoryRetainCompletedResultV1 = z.infer<typeof HindsightMemoryRetainCompletedResultV1Schema>;
