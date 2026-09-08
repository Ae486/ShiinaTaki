/**
 * INPUT:  authenticated Hindsight client, verified B5 checkpoint, trusted projection, and captured Bank/authority/deadline bindings
 * OUTPUT: complete incremental catch-up or verified logical reconciliation/reset with atomic local publication
 * POS:    core/memory/hindsight — offline-testable B5 data-plane runner; runtime/B4 activation wiring remains external
 */
import {
  MemoryReplicaBankSchema, type HindsightConnectionProjection, type MemoryReplicaBank,
  type MemoryAuthorityEpoch, type MemoryReplicaCheckpoint, type MemoryReplicaRunResult, type MemoryReplicaScheduledRun,
} from "@taki/shared";
import { z } from "zod";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { canonicalJson } from "../legacy-migration/legacy-identities.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import { createHindsightCompatibilityService } from "./hindsight-compatibility-service.ts";
import { syncHindsightBankPage } from "./hindsight-incremental-sync.ts";
import type { HindsightReplicaProjection } from "./hindsight-replica-projection.ts";
import { loadHindsightReplicaSnapshot } from "./hindsight-replica-snapshot-loader.ts";

export interface HindsightReplicaRunInput {
  bank: MemoryReplicaBank; run: MemoryReplicaScheduledRun; signal: AbortSignal;
  deadlineAt?: string;
  expectedAuthority?: Pick<MemoryAuthorityEpoch, "epochId" | "providerLineageId">;
}
export interface HindsightReplicaSchedulerRunner {
  run(input: HindsightReplicaRunInput): Promise<MemoryReplicaRunResult>;
  rebuild(input: HindsightReplicaRunInput): Promise<MemoryReplicaRunResult>;
}
interface RunnerDependencies {
  client: HindsightClient; repo: HindsightReplicaSyncRepo; projection: HindsightReplicaProjection;
  connection: HindsightConnectionProjection; secretMarker: string; now?: () => string; deadlineMs?: number;
}
interface RunContext {
  bank: MemoryReplicaBank; checkpoint: MemoryReplicaCheckpoint; providerLineageId: string; deadlineAt: string;
  request: () => HindsightCallContext; now: () => string;
}

export function createHindsightReplicaSyncRunner(deps: RunnerDependencies): HindsightReplicaSchedulerRunner {
  const deadlineMs = z.int().min(1).max(3_600_000).parse(deps.deadlineMs ?? 60_000);
  deps = { ...deps, deadlineMs };
  return {
    run: async (input) => {
      const context = await admit(deps, input);
      if (context.checkpoint.providerLineageId !== context.providerLineageId) throw new Error("HINDSIGHT_REPLICA_LINEAGE_MISMATCH");
      return input.run.kind === "full" ? reconcile({ deps, input, context, reset: false }) : incremental(deps, input, context);
    },
    rebuild: async (input) => reconcile({ deps, input, context: await admit(deps, input), reset: true }),
  };
}

async function admit(deps: RunnerDependencies, input: HindsightReplicaRunInput): Promise<RunContext> {
  const bank = MemoryReplicaBankSchema.parse(input.bank);
  deps.repo.leases.assert(input.run.lease);
  if (input.run.lease.bankId !== bank.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_MISMATCH");
  const scope = deps.projection.bankScope(bank.bankId);
  if (scope.kind !== bank.scope || scope.characterId !== bank.characterId) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  const checkpoint = deps.repo.checkpoint(bank.bankId);
  if (!checkpoint) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  if (canonicalJson(checkpoint) !== canonicalJson(input.run.predecessor)) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
  const now = deps.now ?? (() => new Date().toISOString());
  const deadlineAt = input.deadlineAt ?? new Date(Date.parse(now()) + (deps.deadlineMs ?? 60_000)).toISOString();
  const request = () => requestContext({ now, deadlineAt, signal: input.signal, timeoutMs: deps.connection.requestTimeoutMs });
  request();
  const admitted = await createHindsightCompatibilityService().validate({ connection: deps.connection,
    secretMarker: deps.secretMarker, client: deps.client, signal: input.signal });
  request();
  deps.repo.leases.assert(input.run.lease);
  const providerLineageId = admitted.compatibility.providerLineage;
  if (providerLineageId === null) throw new Error("HINDSIGHT_DATABASE_UNSUPPORTED");
  if (input.expectedAuthority && (providerLineageId !== input.expectedAuthority.providerLineageId
    || checkpoint.authorityEpochId !== input.expectedAuthority.epochId)) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  return { bank, checkpoint, providerLineageId, deadlineAt, request, now };
}

async function incremental(deps: RunnerDependencies, input: HindsightReplicaRunInput, context: RunContext): Promise<MemoryReplicaRunResult> {
  while (true) {
    const result = await syncHindsightBankPage({ client: deps.client, repo: deps.repo, lease: input.run.lease,
      projection: deps.projection, context: context.request(), deadlineAt: context.deadlineAt, expectedBank: context.bank,
      expectedAuthority: input.expectedAuthority });
    context.request();
    if (!result.hasMore) return { checkpoint: result.checkpoint, observedCursor: result.observedCursor };
  }
}

async function reconcile(value: { deps: RunnerDependencies; input: HindsightReplicaRunInput; context: RunContext; reset: boolean }): Promise<MemoryReplicaRunResult> {
  const { deps, input, context } = value;
  const snapshot = await loadHindsightReplicaSnapshot({ client: deps.client, repo: deps.repo, bankId: context.bank.bankId,
    providerLineageId: context.providerLineageId, context: context.request, now: context.now });
  context.request();
  const checkpoint = deps.repo.reconcileVerifiedSnapshot({ ...snapshot, lease: input.run.lease,
    authorityEpochId: context.checkpoint.authorityEpochId, expectedProviderLineageId: context.providerLineageId,
    expectedBankGeneration: snapshot.metadata.manifest.bankGeneration, expectedCheckpoint: context.checkpoint,
    reset: value.reset || snapshot.metadata.manifest.bankGeneration !== context.checkpoint.bankGeneration,
    deadlineAt: context.deadlineAt, expectedBank: context.bank, expectedAuthority: input.expectedAuthority });
  return { checkpoint, observedCursor: snapshot.metadata.manifest.endCursor };
}

function requestContext(input: { now: () => string; deadlineAt: string; signal: AbortSignal; timeoutMs: number }): HindsightCallContext {
  if (input.signal.aborted) throw new Error("HINDSIGHT_CANCELLED");
  const remaining = Date.parse(input.deadlineAt) - Date.parse(input.now());
  if (remaining <= 0) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  return { signal: input.signal, timeoutMs: Math.min(input.timeoutMs, remaining) };
}
