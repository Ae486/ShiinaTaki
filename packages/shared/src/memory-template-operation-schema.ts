/**
 * INPUT:  Core-issued preview references and explicit original-plan recovery requests
 * OUTPUT: closed template operation requests, producer references, results and refusal codes
 * POS:    shared memory.operations extension — callers never supply a Native snapshot or executor ownership
 */
import { z } from "zod";
import { HindsightTemplateHashSchema } from "./hindsight-template-definition-schema.ts";

export const MemoryTemplateErrorCodeSchema = z.enum([
  "MEMORY_TEMPLATE_UNSUPPORTED", "MEMORY_TEMPLATE_PREVIEW_EXPIRED", "MEMORY_TEMPLATE_CONFLICT", "MEMORY_TEMPLATE_HOLD",
  "MEMORY_TEMPLATE_PLAN_NOT_FOUND", "MEMORY_TEMPLATE_LEASE_LOST", "MEMORY_TEMPLATE_IDENTITY_CHANGED",
  "MEMORY_TEMPLATE_OUTCOME_UNKNOWN", "MEMORY_TEMPLATE_NATIVE_REFUSED", "MEMORY_TEMPLATE_BINDING_UNAVAILABLE",
  "MEMORY_TEMPLATE_EVIDENCE_INVALID", "MEMORY_TEMPLATE_QUARANTINED", "MEMORY_TEMPLATE_TOO_LARGE",
  "MEMORY_TEMPLATE_ALREADY_BOUND",
]);
export type MemoryTemplateErrorCode = z.infer<typeof MemoryTemplateErrorCodeSchema>;
export const MemoryTemplateApplyRequestSchema = z.strictObject({
  kind: z.literal("template.apply"), requestId: z.uuid(), previewId: z.uuid(), previewHash: HindsightTemplateHashSchema,
});
export const MemoryTemplateRecoverRequestSchema = z.strictObject({
  kind: z.literal("template.recover"), requestId: z.uuid(), planId: z.uuid(),
});
export const MemoryTemplateRequestSchema = z.discriminatedUnion("kind", [MemoryTemplateApplyRequestSchema, MemoryTemplateRecoverRequestSchema]);
export type MemoryTemplateRequest = z.infer<typeof MemoryTemplateRequestSchema>;
export const MemoryTemplatePhaseSchema = z.enum([
  "admitted", "quiescing", "applying", "verifying", "publishing", "rebinding", "settled",
]);
export const MemoryTemplateProducerRefSchema = z.strictObject({
  kind: z.literal("template"), planId: z.uuid(), requestId: z.uuid(), phase: MemoryTemplatePhaseSchema,
});
export type MemoryTemplateProducerRef = z.infer<typeof MemoryTemplateProducerRefSchema>;
export const MemoryTemplateResultSchema = z.strictObject({
  kind: z.literal("template"), planId: z.uuid(), originalOperationId: z.uuid(), publicationId: z.uuid().nullable(),
  outcome: z.enum(["bound", "binding_unavailable", "partial", "outcome_unknown", "cancelled", "quarantined"]),
  appliedBanks: z.int().min(0).max(256), totalBanks: z.int().min(1).max(256),
}).refine((value) => value.appliedBanks <= value.totalBanks
  && (!["bound", "binding_unavailable"].includes(value.outcome) || value.publicationId !== null && value.appliedBanks === value.totalBanks));
export type MemoryTemplateResult = z.infer<typeof MemoryTemplateResultSchema>;
