/**
 * INPUT:  sanitized primary source, its single Write Gate decision and verified native Bank bindings
 * OUTPUT: durable source-only plans, original retain payloads, stable operation identities and coverage codecs
 * POS:    core/memory/hindsight — internal ingestion journal contract; never derives native memory facts
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { MemoryReplicaBankSchema, RetainRequestSchema, RetainCompletedResultSchema, TAKI_MEMORY_DEFAULT_IMPORTANCE } from "@taki/shared";
import { CanonicalWriteGateDecisionSchema } from "../canonical-ingestion-plan.ts";
import { SanitizedCommittedSpanSchema, retainedIngestionSource } from "../canonical-ingestion-source.ts";
import { HindsightSourceLifetimeSchema } from "./hindsight-source-lifetime.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const HindsightIngestionScopeSchema = z.object({ epochId: Id, characterId: Id });
export type HindsightIngestionScope = z.infer<typeof HindsightIngestionScopeSchema>;
export const HindsightIngestionBindingSchema = z.strictObject({
  bank: MemoryReplicaBankSchema, providerLineageId: z.uuid(), bankGeneration: z.uuid(), baseCursor: z.int().nonnegative(),
});
export type HindsightIngestionBinding = z.infer<typeof HindsightIngestionBindingSchema>;
export const HindsightIngestionBatchSchema = HindsightIngestionBindingSchema.extend({ requestId: Id, request: RetainRequestSchema });
export type HindsightIngestionBatch = z.infer<typeof HindsightIngestionBatchSchema>;
export const HindsightIngestionCoverageSchema = z.strictObject({
  bankId: Id, requestId: Id, status: z.enum(["pending", "confirmed"]),
  // Optional only for historical journals. Missing original evidence cannot authorize dependent initiative output.
  sourceBinding: HindsightSourceLifetimeSchema.shape.sourceBinding.optional(),
  memoryBindings: HindsightSourceLifetimeSchema.shape.memoryBindings.optional(),
  evidence: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("outbox"), operationId: Id, intentHash: Digest }),
    z.strictObject({ kind: z.literal("provider"), result: RetainCompletedResultSchema }),
  ]),
}).refine((value) => value.evidence.kind !== "provider" || value.status === "confirmed", "provider completion cannot be pending");
export type HindsightIngestionCoverage = z.infer<typeof HindsightIngestionCoverageSchema>;
export const HindsightIngestionStateSchema = z.strictObject({
  epochId: Id, providerLineageId: z.uuid(), characterId: Id, spanId: Id, sourceHash: Digest,
  source: SanitizedCommittedSpanSchema, gate: CanonicalWriteGateDecisionSchema.nullable(),
  batches: z.array(HindsightIngestionBatchSchema).max(2), receipts: z.array(HindsightIngestionCoverageSchema).max(2),
  state: z.enum(["pending", "complete"]), revision: z.int().positive(), createdAt: Timestamp, updatedAt: Timestamp,
});
export type HindsightIngestionState = z.infer<typeof HindsightIngestionStateSchema>;

export function hindsightIngestionIdentity(input: HindsightIngestionScope & { sourceHash: string }): string {
  return `hindsight-ingest:${hash(JSON.stringify([input.epochId, input.characterId, input.sourceHash]))}`;
}
export function hindsightIngestionBankIdentity(spanId: string, binding: HindsightIngestionBinding): string {
  return `hindsight-ingest-bank:${hash(JSON.stringify([spanId, binding.bank.bankId, binding.bankGeneration]))}`;
}

export function prepareHindsightIngestionBatch(state: HindsightIngestionState, binding: HindsightIngestionBinding): HindsightIngestionBatch {
  const gate = state.gate;
  if (gate?.decision !== "keep") throw new Error("MEMORY_INGESTION_INCOMPLETE");
  const selected = state.source.messages.filter((message) => message.seq >= gate.fromSeq && message.seq <= gate.throughSeq);
  if (!selected.length || selected[0]?.seq !== gate.fromSeq || selected.at(-1)?.seq !== gate.throughSeq) {
    throw new Error("MEMORY_INGESTION_SOURCE_UNPROVEN");
  }
  const source = retainedIngestionSource(selected);
  const capturedAt = selected.at(-1)?.createdAt;
  const requestId = hindsightIngestionBankIdentity(state.spanId, binding);
  return HindsightIngestionBatchSchema.parse({ ...binding, requestId, request: {
    bankId: binding.bank.bankId, content: source.text, context: null, timestamp: capturedAt,
    tags: [], entities: [], observationScopes: null, strategy: null, updateMode: "replace",
    documentId: `hindsight-source:${hash(requestId)}`,
    metadata: { "taki:conversation-source:v1": { version: 1, spanId: state.spanId, entries: source.entries } },
    provenance: { actor: "agent", origin: "auto-gate", characterId: state.characterId,
      timelineFromSeq: gate.fromSeq, timelineToSeq: gate.throughSeq, capturedAt, sanitized: true,
      sourceRef: `timeline:${state.characterId}:${gate.fromSeq}:${gate.throughSeq}` },
    // This versioned source-intent hint grants no per-fact native layer, policy or completed assessment.
    policy: { layerId: "unclassified", importance: TAKI_MEMORY_DEFAULT_IMPORTANCE, visibility: "retrieved",
      disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 },
  } });
}

export function assertHindsightIngestionPlan(state: HindsightIngestionState): void {
  const expected = state.gate?.decision === "keep" ? state.gate.route === "both" ? 2 : 1 : 0;
  // A completed gate can wait durably for verified Bank routing without another model judgment.
  if (state.state === "pending" && state.gate?.decision === "keep" && state.batches.length === 0 && state.receipts.length === 0) return;
  if (state.batches.length !== expected || new Set(state.batches.map((batch) => batch.bank.scope)).size !== expected
    || new Set(state.batches.map((batch) => batch.bank.bankId)).size !== expected) throw new Error("MEMORY_INGESTION_STATE_INVALID");
  for (const batch of state.batches) {
    if (batch.providerLineageId !== state.providerLineageId
      || batch.bank.scope === "character" && batch.bank.characterId !== state.characterId
      || state.gate?.decision !== "keep" || state.gate.route !== "both" && batch.bank.scope !== state.gate.route
      || JSON.stringify(batch) !== JSON.stringify(prepareHindsightIngestionBatch(state, batch))) {
      throw new Error("MEMORY_INGESTION_STATE_INVALID");
    }
  }
  if (new Set(state.receipts.map((receipt) => receipt.bankId)).size !== state.receipts.length) throw new Error("MEMORY_INGESTION_STATE_INVALID");
  for (const receipt of state.receipts) {
    const batch = state.batches.find((value) => value.bank.bankId === receipt.bankId && value.requestId === receipt.requestId);
    if (!batch || receipt.evidence.kind === "provider" && receipt.evidence.result.documentId !== batch.request.documentId
      || receipt.evidence.kind === "outbox" && receipt.evidence.operationId !== batch.requestId) throw new Error("MEMORY_INGESTION_STATE_INVALID");
  }
  if (state.state === "complete" && (state.gate === null || state.receipts.length !== expected)) throw new Error("MEMORY_INGESTION_STATE_INVALID");
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
