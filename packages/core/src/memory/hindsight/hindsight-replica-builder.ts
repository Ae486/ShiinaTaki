/**
 * INPUT:  one admitted Hindsight client, Bank identity, and local replica staging repository
 * OUTPUT: verified cursor-bound snapshot staged and checkpoint-published without authority mutation
 * POS:    core/memory/hindsight — Wave 3 orchestration seam; uses snapshot pages only, never offset listing
 */
import { randomUUID } from "node:crypto";
import type { HindsightReplicaCheckpoint } from "@taki/shared";
import type { HindsightReplicaRepo } from "../../db/hindsight-replica-repo.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import { verifyLogicalSnapshot } from "./hindsight-snapshot-validator.ts";

export async function buildHindsightReplica(input: {
  client: HindsightClient;
  repo: HindsightReplicaRepo;
  runId: string;
  bankId: string;
  providerLineage: string;
  pageSize: number;
  ttlSeconds: number;
  reconcile: (stagingId: string) => void;
  now?: () => string;
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<{ stagingId: string; checkpoint: HindsightReplicaCheckpoint }> {
  const now = input.now ?? (() => new Date().toISOString());
  const deadline = Date.now() + (input.deadlineMs ?? 60_000);
  if (!input.client.createLogicalSnapshot || !input.client.logicalSnapshot || !input.client.logicalSnapshotPage) {
    throw new Error("HINDSIGHT_SNAPSHOT_CLIENT_UNAVAILABLE");
  }
  const metadata = await input.client.createLogicalSnapshot({ bankId: input.bankId, pageSize: input.pageSize,
    ttlSeconds: input.ttlSeconds, context: context(input.signal, deadline) });
  const reread = await input.client.logicalSnapshot(input.bankId, metadata.snapshotId, context(input.signal, deadline));
  if (JSON.stringify(metadata) !== JSON.stringify(reread)) throw new Error("HINDSIGHT_SNAPSHOT_MANIFEST_CHANGED");
  const pages = [];
  for (let pageNumber = 0; pageNumber < metadata.manifest.totalPages; pageNumber += 1) {
    pages.push(await input.client.logicalSnapshotPage({ bankId: input.bankId, snapshotId: metadata.snapshotId,
      pageNumber, context: context(input.signal, deadline) }));
  }
  const verified = verifyLogicalSnapshot({ metadata, pages, expectedBankId: input.bankId,
    expectedProviderLineage: input.providerLineage, now: now() });
  const staged = input.repo.stage({ runId: input.runId, replicaEpochId: randomUUID(), metadata: verified.metadata,
    pages: verified.pages, now: now() });
  input.reconcile(staged.stagingId);
  const checkpoint = input.repo.publish({ stagingId: staged.stagingId, capturedAt: verified.metadata.createdAt,
    publishedAt: now() });
  return { stagingId: staged.stagingId, checkpoint };
}

function context(signal: AbortSignal | undefined, deadline: number): HindsightCallContext {
  if (signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
  const timeoutMs = deadline - Date.now();
  if (timeoutMs <= 0) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  return { timeoutMs, signal };
}
