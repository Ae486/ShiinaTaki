/**
 * INPUT:  one admitted Bank recovery context and durable Pending Memory rows
 * OUTPUT: retain-first native replay, operation-scoped derived checks, and rows ready for the second pull
 * POS:    core/memory/hindsight — bounded asynchronous stages under the existing replica worker and lease
 */
import { MemoryDerivedCompletionRequestSchema, MemoryDerivedCompletionResultSchema, type MemoryReplicaCheckpoint, type PendingMemoryRecord } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { pendingMemoryTerminal } from "../../db/pending-memory-transition.ts";
import { change, handlePendingFailure, replayPendingNative, resolvePendingNative, type PendingReplayContext } from "./hindsight-pending-replay.ts";
import type { MemoryDerivedCompletionPort } from "./hindsight-derived-completion.ts";

interface StageContext extends PendingReplayContext {
  checkpoint: MemoryReplicaCheckpoint; forceRetry: boolean; derivedCompletion: MemoryDerivedCompletionPort;
}

export async function replayPendingBank(context: StageContext): Promise<PendingMemoryRecord[]> {
  const held: PendingMemoryRecord[] = [];
  for (const kind of ["retain", "mutation"] as const) {
    let afterSequence = 0;
    for (;;) {
      context.request();
      const page = context.pending.list({ authorityEpochId: context.checkpoint.authorityEpochId,
        bankId: context.checkpoint.bankId, afterSequence, kind, limit: 100,
        phases: ["queued", "submitted", "awaiting_derived", "awaiting_pull"] });
      if (page.length === 0) break;
      for (const row of page) {
        afterSequence = row.sequence;
        if (pendingMemoryTerminal(row)) continue;
        // Reset/rebuild resumes the same scheduled lease after its first promise has retired. Keep its owned stage;
        // re-claiming would skip the row, while a new attempt would misstate retry history or repeat native work.
        const claimed = ownsClaim(context, row) ? row
          : context.pending.claim({ record: row, guard: context.guard, forceRetry: context.forceRetry });
        if (!claimed) continue;
        const record = sameBankGeneration(claimed, context.checkpoint)
          ? await replayPendingNative(context, claimed)
          : change(context, claimed, claimed.nativeReceipt === null && !claimed.nativeResultReceipt
            // Replacement cannot prove whether an already dispatched write took effect in the old generation.
            ? { kind: "terminal", phase: claimed.dispatchedAt === null ? "failed" : "outcome_unknown", code: "HINDSIGHT_PENDING_AUTHORITY_MISMATCH" }
            : { kind: "retry", code: "HINDSIGHT_PENDING_AUTHORITY_MISMATCH" });
        held.push(record);
      }
    }
  }
  // Submit every independent intent before inspecting asynchronous native completion; a slow retain cannot starve the next write.
  for (const [index, record] of held.entries()) {
    if (ownsClaim(context, record)) held[index] = await resolvePendingNative(context, record);
  }
  return held;
}

export async function checkPendingDerived(context: StageContext, records: PendingMemoryRecord[]): Promise<PendingMemoryRecord[]> {
  const result: PendingMemoryRecord[] = [];
  for (const record of records) {
    if (!ownsClaim(context, record)) { result.push(record); continue; }
    result.push(await checkOneDerived(context, record));
  }
  return result;
}

async function checkOneDerived(context: StageContext, record: PendingMemoryRecord): Promise<PendingMemoryRecord> {
  if (record.phase !== "awaiting_derived" || record.nativeReceipt === null) return record;
  try {
    const intent = record.intent;
    const result = MemoryDerivedCompletionResultSchema.parse(await context.derivedCompletion.check({ request: MemoryDerivedCompletionRequestSchema.parse({
      schemaVersion: 1, authorityEpochId: intent.authorityEpochId, bankId: intent.bank.bankId, providerLineageId: intent.providerLineageId,
      bankGeneration: intent.bankGeneration, operationId: record.remoteOperationId,
      nativeReceiptHash: canonicalPayloadHash(record.nativeReceipt), afterCursor: intent.baseCursor, receipt: record.nativeReceipt,
    }), context: context.request() }));
    context.request();
    return result.status === "pending" ? change(context, record, { kind: "retry", code: "HINDSIGHT_PENDING_REMAINS" })
      : change(context, record, { kind: "derived_completed", evidence: result.evidence });
  } catch (error) { return handlePendingFailure(context, record, error); }
}

function sameBankGeneration(record: PendingMemoryRecord, checkpoint: MemoryReplicaCheckpoint): boolean {
  return record.intent.bankGeneration === checkpoint.bankGeneration && record.intent.providerLineageId === checkpoint.providerLineageId
    && record.intent.authorityEpochId === checkpoint.authorityEpochId;
}

function ownsClaim(context: PendingReplayContext, record: PendingMemoryRecord): boolean {
  return !pendingMemoryTerminal(record) && canonicalJson(record.lease) === canonicalJson(context.guard.lease);
}
