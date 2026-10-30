/**
 * INPUT:  an authorized canonical retain/mutation request, captured call identity, and trusted Bank binding
 * OUTPUT: one durable unconfirmed intent under the current Hindsight checkpoint, or a bounded refusal
 * POS:    core/memory — explicit outage-write admission for B6 composition; no authority fallback or live runtime wiring
 */
import { PendingMemoryOperationSchema, type MemoryReplicaBank, type PendingMemoryOperation, type PendingMemoryRecord } from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { HindsightReplicaSyncRepo } from "../db/hindsight-replica-sync-repo.ts";
import type { PendingMemoryRepo } from "../db/pending-memory-repo.ts";
import type { MemoryProviderCallContext } from "./memory-provider.ts";
import { canonicalJson } from "./legacy-migration/legacy-identities.ts";

interface Dependencies {
  authority: CanonicalMemoryAuthorityRepo; replica: HindsightReplicaSyncRepo; pending: PendingMemoryRepo; now?: () => string;
}
export interface PendingMemoryWriter {
  enqueue(operation: PendingMemoryOperation, call: MemoryProviderCallContext, bank: MemoryReplicaBank): PendingMemoryRecord;
}

export function createPendingMemoryWriter(deps: Dependencies): PendingMemoryWriter {
  return { enqueue: (operation, call, bank) => enqueue(deps, { operation, call, bank }) };
}

function enqueue(deps: Dependencies, input: { operation: PendingMemoryOperation; call: MemoryProviderCallContext; bank: MemoryReplicaBank }): PendingMemoryRecord {
  if (input.call.signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
  const epoch = deps.authority.authorityEpoch(input.call.authorityEpochId);
  if (epoch.providerId !== "hindsight") throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  const parsed = PendingMemoryOperationSchema.safeParse(input.operation);
  if (!parsed.success || parsed.data.request.bankId !== input.bank.bankId) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSAFE");
  const operation = parsed.data;
  const previous = deps.pending.get({ authorityEpochId: epoch.epochId, bankId: input.bank.bankId, operationId: input.call.requestId });
  if (previous) {
    if (canonicalJson(previous.intent.operation) !== canonicalJson(operation) || canonicalJson(previous.intent.bank) !== canonicalJson(input.bank)) {
      throw new Error("HINDSIGHT_PENDING_IDENTITY_CONFLICT");
    }
    return previous;
  }
  const checkpoint = deps.replica.checkpoint(input.bank.bankId);
  if (!checkpoint) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  return deps.pending.enqueue({ schemaVersion: 1, authorityEpochId: epoch.epochId, providerId: "hindsight",
    providerLineageId: epoch.providerLineageId, bankGeneration: checkpoint.bankGeneration, bank: input.bank,
    operationId: input.call.requestId, baseCursor: checkpoint.endCursor, operation,
    originalAt: operation.kind === "retain" ? operation.request.provenance.capturedAt : deps.now?.() ?? new Date().toISOString() });
}
