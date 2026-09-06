/**
 * INPUT:  one admitted Hindsight client, verified Bank checkpoint, trusted Taki projection, and optional run deadline
 * OUTPUT: one complete journal page pulled and atomically committed under a Core-issued lease and deadline
 * POS:    core/memory/hindsight — B5 one-Bank synchronization primitive, detached from runtime recall and authority
 */
import type { MemoryReplicaBank, MemoryReplicaCheckpoint, MemoryReplicaLease } from "@taki/shared";
import type { HindsightClient, HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { projectHindsightJournal, type HindsightReplicaProjection } from "./hindsight-replica-projection.ts";

export async function syncHindsightBankPage(input: {
  client: HindsightClient; repo: HindsightReplicaSyncRepo; lease: MemoryReplicaLease;
  projection: HindsightReplicaProjection; context: HindsightCallContext; deadlineAt?: string; expectedBank?: MemoryReplicaBank;
}): Promise<{ checkpoint: MemoryReplicaCheckpoint; hasMore: boolean; observedCursor: number }> {
  if (!input.client.changesAfter) throw new Error("HINDSIGHT_JOURNAL_CLIENT_UNAVAILABLE");
  input.repo.leases.assert(input.lease);
  const expectedCheckpoint = input.repo.checkpoint(input.lease.bankId);
  if (!expectedCheckpoint) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  const journal = await input.client.changesAfter({ bankId: input.lease.bankId,
    afterCursor: expectedCheckpoint.endCursor, limit: 500, context: input.context });
  if (input.context.signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
  const page = projectHindsightJournal(journal, { bankId: input.lease.bankId,
    authorityEpochId: expectedCheckpoint.authorityEpochId, projection: input.projection });
  const checkpoint = input.repo.applyPage({ page, expectedCheckpoint, lease: input.lease,
    deadlineAt: input.deadlineAt, expectedBank: input.expectedBank });
  return { checkpoint, hasMore: page.hasMore, observedCursor: page.currentCursor };
}
