/**
 * INPUT:  reserved target request and actual Local operation or Hindsight parent receipt
 * OUTPUT: immutable factual queue result reconstructed after effect-before-ack failure
 * POS:    core/db — positive receipt lookup only; missing/unknown native effects remain owned under the original ID
 */
import { MemoryTransitionQueueOutcomeSchema, HindsightMemoryRetainCompletedResultV1Schema,
  type MemoryTransitionQueuedIntent, type MemoryTransitionQueueExecution, type MemoryTransitionQueueOutcome } from "@taki/shared";
import { z } from "zod";
import { readCanonicalReceipt } from "./canonical-memory-maintenance-storage.ts";
import { stableRequestHash } from "./canonical-memory-repo.ts";
import { readHindsightMemoryWrite } from "./hindsight-memory-write-storage.ts";
import { readTransitionLocalRefusal } from "./memory-transition-target-refusal.ts";
import { readTransitionPendingState, transitionPendingRefusal } from "./memory-transition-pending-refusal.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { transitionTargetCommand } from "../memory/transitions/transition-queue-mapping.ts";
import type { Database } from "./sqlite.ts";

export function reconcileTransitionEffect(db: Database, input: { intent: MemoryTransitionQueuedIntent; execution: MemoryTransitionQueueExecution;
  provider: "local" | "hindsight"; now: string }): MemoryTransitionQueueOutcome | undefined {
  const { intent, execution } = input;
  const command = transitionTargetCommand(intent, execution);
  const original = readTransitionTargetReceipt(db, { execution, command, provider: input.provider });
  const saved = db.prepare("SELECT intent_id,receipt_json FROM memory_transition_effect_receipts WHERE target_request_id=:id").get({ id: execution.targetRequestId });
  if (saved) {
    const value = MemoryTransitionQueueOutcomeSchema.parse(JSON.parse(String(saved.receipt_json)));
    if (saved.intent_id !== intent.intentId || value.intentId !== intent.intentId || !("targetRequestId" in value)
      || value.targetRequestId !== execution.targetRequestId || !original || !("receiptId" in value)
      || value.receiptId !== transitionLocalHash(original.receipt)
      || transitionLocalHash(value) !== transitionLocalHash({ ...original.outcome, intentId: intent.intentId,
        targetRequestId: execution.targetRequestId, receiptId: value.receiptId, settledAt: value.settledAt })) invalid(); return value;
  }
  if (!original) return undefined;
  const value = MemoryTransitionQueueOutcomeSchema.parse({ ...original.outcome, intentId: intent.intentId,
    targetRequestId: execution.targetRequestId, receiptId: transitionLocalHash(original.receipt), settledAt: input.now });
  db.prepare("INSERT INTO memory_transition_effect_receipts VALUES(:request,:intent,:json)")
    .run({ request: execution.targetRequestId, intent: intent.intentId, json: JSON.stringify(value) });
  return value;
}
type ReceiptInput = { execution: MemoryTransitionQueueExecution; command: ReturnType<typeof transitionTargetCommand> };
export function readTransitionTargetReceipt(db: Database, input: ReceiptInput & { provider: "local" | "hindsight" }) {
  return input.provider === "local" ? localReceipt(db, input) : nativeReceipt(db, input);
}
function localReceipt(db: Database, input: ReceiptInput) {
  const receipt = readCanonicalReceipt(db, input.execution.targetEpochId, input.execution.targetRequestId);
  if (!receipt) {
    const refusal = readTransitionLocalRefusal(db, input);
    return refusal ? { receipt: refusal, outcome: { status: "failed", errorCode: refusal.errorCode } } : undefined;
  }
  if (receipt.requestHash !== stableRequestHash(input.command.request)) invalid();
  if (input.command.kind === "retain") return { receipt, outcome: { status: "completed", result: { kind: "retain",
    value: HindsightMemoryRetainCompletedResultV1Schema.parse({ status: "completed", ...(receipt.result as object) }) } } };
  const result = z.object({ memoryId: z.string(), revision: z.int().positive() }).parse(receipt.result);
  if (result.memoryId !== input.execution.targetLogicalId) invalid();
  return { receipt, outcome: { status: "completed", result: { kind: "mutation", ...result } } };
}
function nativeReceipt(db: Database, input: ReceiptInput) {
  const job = readHindsightMemoryWrite(db, { authorityEpochId: input.execution.targetEpochId,
    bankId: input.execution.targetBankId, requestId: input.execution.targetRequestId });
  if (!job?.terminal) return undefined;
  if (transitionLocalHash(job.identity.operation.request) !== transitionLocalHash(input.command.request)) invalid();
  const terminal = job.terminal;
  if (terminal.kind === "error") {
    if (job.nativeOperationId !== null) {
      const child = readTransitionPendingState(db, { authorityEpochId: input.execution.targetEpochId,
        bankId: input.execution.targetBankId, operationId: job.nativeOperationId });
      if (!child) invalid();
      if (child.intent.providerLineageId !== job.identity.namespace.provider_lineage
        || child.intent.bankGeneration !== job.identity.namespace.bank_generation) invalid();
      if (!transitionPendingRefusal(child)) return undefined;
      return { receipt: { job, child }, outcome: { status: "failed", errorCode: terminal.code } };
    }
    return { receipt: job, outcome: { status: "failed", errorCode: terminal.code } };
  }
  if (terminal.kind === "retain") return { receipt: job, outcome: { status: "completed", result: { kind: "retain", value: terminal.result } } };
  if (terminal.result.record === null) return { receipt: job, outcome: { status: "failed", errorCode: "MEMORY_NOT_FOUND" } };
  if (terminal.result.outcome === "superseded") return { receipt: job, outcome: { status: "failed", errorCode: "MEMORY_REVISION_MISMATCH" } };
  return { receipt: job, outcome: { status: "completed", result: { kind: "mutation", memoryId: terminal.result.record.unit.memoryId,
    revision: terminal.result.record.unit.revision } } };
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
