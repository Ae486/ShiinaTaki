/**
 * INPUT:  durable whole-write state and its independently confirmed native child
 * OUTPUT: truthful current pending projections and immutable public operation results
 * POS:    core/memory/hindsight — result projection only; missing revisions and completion evidence stay absent
 */
import {
  HindsightMemoryMutationResultV1Schema, HindsightMemoryRetainResultV1Schema,
  type MutationResult, type PendingMemoryRecord, type RecallPendingMutationOverlayEntry, type RetainResult,
} from "@taki/shared";
import type { HindsightMemoryWriteJob } from "../../db/hindsight-memory-write-contract.ts";
import type { HindsightMemoryWriteDeps } from "./hindsight-memory-write-context.ts";

export function hindsightMemoryWriteChild(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob): PendingMemoryRecord | undefined {
  if (job.nativeOperationId === null) return undefined;
  const row = deps.pending.get({ authorityEpochId: job.identity.key.authorityEpochId, bankId: job.identity.key.bankId, operationId: job.nativeOperationId });
  if (!row || row.intent.providerLineageId !== job.identity.namespace.provider_lineage
    || row.intent.bankGeneration !== job.identity.namespace.bank_generation) throw new Error("MEMORY_INTEGRITY_ERROR");
  return row;
}

export function hindsightMemoryMutationPending(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob): RecallPendingMutationOverlayEntry {
  const operation = job.identity.operation; if (operation.kind !== "mutation" || job.terminal) throw new Error("MEMORY_INTEGRITY_ERROR");
  const child = hindsightMemoryWriteChild(deps, job);
  const command = job.applicationKey ? deps.writer.get(job.applicationKey) : undefined;
  const phase = child?.phase === "outcome_unknown" ? "outcome_unknown" : command?.state === "completed" || child?.phase === "completed" ? "awaiting_pull"
    : command?.state === "dispatched" ? "submitted" : child && ["submitted", "awaiting_derived", "awaiting_pull"].includes(child.phase)
      ? child.phase as "submitted" | "awaiting_derived" | "awaiting_pull" : "queued";
  return { confirmed: false, authorityEpochId: job.identity.key.authorityEpochId, bankId: job.identity.key.bankId,
    operationId: job.identity.key.requestId, originalAt: job.preparedAt, phase, operation };
}

export function hindsightMemoryRetainResult(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob): RetainResult {
  if (job.terminal?.kind === "error") throw new Error(job.terminal.code);
  if (job.terminal?.kind === "retain") return job.terminal.result;
  if (job.terminal || job.identity.operation.kind !== "retain") throw new Error("MEMORY_INTEGRITY_ERROR");
  const row = hindsightMemoryWriteChild(deps, job); if (!row) throw new Error("MEMORY_INTEGRITY_ERROR");
  return HindsightMemoryRetainResultV1Schema.parse({ status: "pending", operationId: row.intent.operationId,
    documentId: row.documentId, sourceRevision: null, memories: job.references?.memories ?? [] });
}

export function hindsightMemoryMutationResult(deps: HindsightMemoryWriteDeps, job: HindsightMemoryWriteJob): MutationResult {
  if (job.terminal?.kind === "error") throw new Error(job.terminal.code);
  if (job.terminal?.kind === "mutation") return job.terminal.result;
  if (job.terminal || job.identity.operation.kind !== "mutation") throw new Error("MEMORY_INTEGRITY_ERROR");
  return HindsightMemoryMutationResultV1Schema.parse({ outcome: "pending", record: null, pending: hindsightMemoryMutationPending(deps, job) });
}
