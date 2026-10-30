/**
 * INPUT:  a frozen source-Bank request, its provider result and the actual durable Pending reader
 * OUTPUT: verified source coverage or a refusal; queue promises alone never establish durability
 * POS:    core/db — synchronous ingestion receipt proof, independent of native assessment/derived freshness
 */
import { RetainEnvelopeSchema } from "@taki/shared";
import type { PendingMemoryRepo } from "./pending-memory-repo.ts";
import { assertHindsightIngestionBinding, type HindsightIngestionBankReader } from "./hindsight-ingestion-guard.ts";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { HindsightIngestionCoverageSchema, type HindsightIngestionBatch, type HindsightIngestionCoverage,
  type HindsightIngestionScope } from "../memory/hindsight/hindsight-ingestion-contract.ts";

export interface HindsightIngestionDurabilityDeps extends HindsightIngestionBankReader {
  pending: Pick<PendingMemoryRepo, "get">;
  captureBinding?(input: { batch: HindsightIngestionBatch; receipt: HindsightIngestionCoverage }):
    Pick<HindsightIngestionCoverage, "sourceBinding" | "memoryBindings"> | undefined;
}
type BatchInput = HindsightIngestionScope & { batch: HindsightIngestionBatch };

export function pendingHindsightSourceCoverage(deps: HindsightIngestionDurabilityDeps, input: BatchInput): HindsightIngestionCoverage | undefined {
  const { batch } = input;
  assertHindsightIngestionBinding(deps, { ...input, ...batch });
  const row = deps.pending.get({ authorityEpochId: input.epochId, bankId: batch.bank.bankId, operationId: batch.requestId });
  if (!row) return;
  const intent = row.intent;
  if (intent.authorityEpochId !== input.epochId || intent.providerId !== "hindsight" || intent.providerLineageId !== batch.providerLineageId
    || intent.bankGeneration !== batch.bankGeneration || intent.operationId !== batch.requestId
    || canonicalJson(intent.bank) !== canonicalJson(batch.bank) || intent.baseCursor < batch.baseCursor
    || intent.originalAt !== batch.request.provenance.capturedAt || row.documentId !== batch.request.documentId
    || intent.operation.kind !== "retain" || canonicalJson(intent.operation.request) !== canonicalJson(batch.request)
    || row.intentHash !== canonicalPayloadHash(intent)
    || !["queued", "submitted", "awaiting_derived", "awaiting_pull", "completed", "outcome_unknown"].includes(row.phase)) {
    throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
  }
  return HindsightIngestionCoverageSchema.parse({ bankId: batch.bank.bankId, requestId: batch.requestId,
    status: row.phase === "completed" ? "confirmed" : "pending",
    evidence: { kind: "outbox", operationId: intent.operationId, intentHash: row.intentHash } });
}

export function captureHindsightSourceCoverage(deps: HindsightIngestionDurabilityDeps, input: BatchInput & { result?: unknown }): HindsightIngestionCoverage {
  const durable = pendingHindsightSourceCoverage(deps, input);
  const parsed = RetainEnvelopeSchema.safeParse(input.result);
  const result = parsed.success ? parsed.data : undefined;
  const { batch } = input;
  if (!result?.ok || result.providerId !== "hindsight" || result.authorityEpochId !== input.epochId
    || result.requestId !== batch.requestId || result.data.status !== "completed"
    || !result.capabilities.retain || !result.capabilities.idempotentWrites
    || result.data.documentId !== batch.request.documentId) {
    if (durable) return durable;
    throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
  }
  const receipt = HindsightIngestionCoverageSchema.parse({ bankId: batch.bank.bankId, requestId: batch.requestId,
    status: "confirmed", evidence: { kind: "provider", result: result.data } });
  return HindsightIngestionCoverageSchema.parse({ ...receipt, ...deps.captureBinding?.({ batch, receipt }) });
}

export function assertHindsightSourceCoverage(deps: HindsightIngestionDurabilityDeps,
  input: BatchInput & { receipt: HindsightIngestionCoverage }): void {
  const { batch, receipt } = input;
  assertHindsightIngestionBinding(deps, { ...input, ...batch });
  if (receipt.bankId !== batch.bank.bankId || receipt.requestId !== batch.requestId) throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
  if (receipt.evidence.kind === "provider") {
    if (receipt.status !== "confirmed" || receipt.evidence.result.documentId !== batch.request.documentId) {
      throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
    }
    return;
  }
  const current = pendingHindsightSourceCoverage(deps, input);
  // Recheck live outbox evidence even for an already completed ingestion span. Later cancellation/failure cannot
  // inherit an old durable-queue receipt; native completion may strengthen the same intent without replaying it.
  if (!current || canonicalJson(current.evidence) !== canonicalJson(receipt.evidence)) throw new Error("MEMORY_INGESTION_RECEIPT_UNPROVEN");
}
