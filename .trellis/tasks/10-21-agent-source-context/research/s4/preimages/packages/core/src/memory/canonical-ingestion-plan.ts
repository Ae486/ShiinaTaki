/**
 * INPUT:  sanitized primary spans, one eligibility/routing decision, and Local extraction results
 * OUTPUT: strict durable ingestion-plan codecs and stable per-span/per-Bank identities
 * POS:    core/memory — internal retry contract; plans never enter public Memory metadata or tool schemas
 */
import { createHash } from "node:crypto";
import { CanonicalMemorySourceSchema, CanonicalMemoryUnitSchema, TakiMemoryPolicyProjectionSchema } from "@taki/shared";
import { z } from "zod";
import { AUTO_LAYER_CHOICES } from "./auto-layer-policy.ts";
import { SanitizedCommittedSpanSchema, ingestionContentHash, retainedIngestionSource } from "./canonical-ingestion-source.ts";

export const CanonicalWriteGateDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({ decision: z.literal("skip") }),
  z.strictObject({ decision: z.literal("keep"), route: z.enum(["global", "character", "both"]),
    fromSeq: z.int().positive(), throughSeq: z.int().positive() }),
]);
export type CanonicalWriteGateDecision = z.infer<typeof CanonicalWriteGateDecisionSchema>;

export const AutomaticLocalFactSchema = z.strictObject({
  layer: z.enum(AUTO_LAYER_CHOICES), content: CanonicalMemoryUnitSchema.shape.text,
  importance: z.int().min(1).max(10), disclosure: TakiMemoryPolicyProjectionSchema.shape.disclosure,
});
export type AutomaticLocalFact = z.infer<typeof AutomaticLocalFactSchema>;

export const PreparedLocalIngestionSchema = z.strictObject({
  epochId: z.string().min(1).max(256), bankId: z.string().min(1).max(256),
  characterId: z.string().min(1).max(256), requestId: z.string().min(1).max(256),
  now: z.iso.datetime({ offset: true }), source: CanonicalMemorySourceSchema,
  units: z.array(z.strictObject({ unit: CanonicalMemoryUnitSchema, policy: TakiMemoryPolicyProjectionSchema,
    searchTerms: z.string() })),
  duplicates: z.array(z.strictObject({ memoryId: z.string().min(1).max(256),
    expectedRevision: z.int().positive(), importance: z.int().min(1).max(10) })),
});
export type PreparedLocalIngestion = z.infer<typeof PreparedLocalIngestionSchema>;

export const LocalIngestionReceiptSchema = z.strictObject({
  documentId: z.string().min(1).max(256), sourceRevision: z.int().positive(),
  memories: z.array(z.strictObject({ memoryId: z.string().min(1).max(256), revision: z.int().positive() })),
  reinforced: z.array(z.strictObject({ memoryId: z.string().min(1).max(256), revision: z.int().positive() })),
});
export type LocalIngestionReceipt = z.infer<typeof LocalIngestionReceiptSchema>;

export const LocalExtractionPlanSchema = z.strictObject({
  facts: z.array(AutomaticLocalFactSchema), batches: z.array(PreparedLocalIngestionSchema).max(2),
});
export type LocalExtractionPlan = z.infer<typeof LocalExtractionPlanSchema>;

export const IngestionBankReceiptSchema = z.strictObject({
  bankId: z.string().min(1).max(256), requestId: z.string().min(1).max(256), result: LocalIngestionReceiptSchema,
});
export const CanonicalIngestionStateSchema = z.strictObject({
  epochId: z.string().min(1).max(256), characterId: z.string().min(1).max(256),
  spanId: z.string().min(1).max(256), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: SanitizedCommittedSpanSchema, gate: CanonicalWriteGateDecisionSchema.nullable(),
  extraction: LocalExtractionPlanSchema.nullable(), bankReceipts: z.array(IngestionBankReceiptSchema).max(2),
  state: z.enum(["pending", "complete"]), revision: z.int().positive(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
});
export type CanonicalIngestionState = z.infer<typeof CanonicalIngestionStateSchema>;

export function canonicalIngestionIdentity(input: { epochId: string; characterId: string; sourceHash: string }): string {
  return `local-ingest:${digest(JSON.stringify([input.epochId, input.characterId, input.sourceHash]))}`;
}

export function canonicalIngestionBankIdentity(spanId: string, bankId: string): string {
  return `local-ingest-bank:${digest(JSON.stringify([spanId, bankId]))}`;
}

export function canonicalIngestionDocumentId(requestId: string): string { return `auto-source:${digest(requestId)}`; }

/** A historical receipt for some other span must never settle this span's source. */
export function assertIngestionBatchSource(state: CanonicalIngestionState, batch: PreparedLocalIngestion): void {
  const gate = state.gate;
  if (gate?.decision !== "keep") throw new Error("MEMORY_INVALID_REQUEST");
  const selected = state.source.messages.filter((message) => message.seq >= gate.fromSeq && message.seq <= gate.throughSeq);
  const content = retainedIngestionSource(selected).text;
  const source = batch.source;
  if (batch.epochId !== state.epochId || batch.characterId !== state.characterId
    || batch.requestId !== canonicalIngestionBankIdentity(state.spanId, batch.bankId)
    || source.authorityEpochId !== state.epochId || source.bankId !== batch.bankId
    || source.documentId !== canonicalIngestionDocumentId(batch.requestId)
    || source.retainedText !== content || source.contentHash !== ingestionContentHash(content)
    || source.provenance.origin !== "auto-gate" || source.provenance.characterId !== state.characterId
    || source.provenance.timelineFromSeq !== gate.fromSeq || source.provenance.timelineToSeq !== gate.throughSeq) {
    throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  }
}

function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }
