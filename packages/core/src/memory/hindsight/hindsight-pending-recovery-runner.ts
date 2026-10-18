/**
 * INPUT:  the replica scheduler claim, admitted Hindsight client, durable outbox, and optional legacy derived port
 * OUTPUT: first pull, tracked native proof, second pull and factual checkpoint confirmation; explicit legacy compatibility
 * POS:    core/memory/hindsight — explicit B5 orchestration; no new scheduler, automatic authority change, or Run Effect replay
 */
import { z } from "zod";
import {
  MemoryReplicaBankSchema, MemoryReplicaScheduledRunSchema,
  HINDSIGHT_CURRENT_STATE_BUILD, HINDSIGHT_NATIVE_RESULT_BUILD, HINDSIGHT_NATIVE_RESULT_VERSION,
  HINDSIGHT_APPLICATION_STATE_BUILD,
  HINDSIGHT_TRANSITION_BUILD,
  HINDSIGHT_CONFIGURATION_BUILD,
  HINDSIGHT_TEMPLATE_BUILD,
  type HindsightConnectionProjection, type MemoryAuthorityEpoch, type MemoryReplicaCheckpoint, type MemoryReplicaRunResult, type PendingMemoryRecord,
} from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import type { PendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import type { HindsightReplicaProjection } from "./hindsight-replica-projection.ts";
import {
  createHindsightReplicaSyncRunner, type HindsightReplicaRunInput, type HindsightReplicaSchedulerRunner,
} from "./hindsight-replica-sync-runner.ts";
import { unavailableHindsightDerivedCompletion, type MemoryDerivedCompletionPort } from "./hindsight-derived-completion.ts";
import { handlePendingFailure, type PendingReplayContext } from "./hindsight-pending-replay.ts";
import { checkPendingDerived, replayPendingBank } from "./hindsight-pending-recovery-stages.ts";

interface RecoveryDependencies {
  client: HindsightClient; replica: HindsightReplicaSyncRepo; pending: PendingMemoryRepo;
  authority: CanonicalMemoryAuthorityRepo; projection: HindsightReplicaProjection;
  connection: HindsightConnectionProjection; secretMarker: string; derivedCompletion?: MemoryDerivedCompletionPort;
  now?: () => string; deadlineMs?: number;
  syncRunner?: HindsightReplicaSchedulerRunner;
  beforeNativeDispatch?: PendingReplayContext["beforeNativeDispatch"];
}
interface RecoveryContext extends PendingReplayContext {
  input: HindsightReplicaRunInput; authority: MemoryAuthorityEpoch; sync: HindsightReplicaSchedulerRunner;
}

export function createHindsightPendingRecoveryRunner(deps: RecoveryDependencies): HindsightReplicaSchedulerRunner {
  const deadlineMs = z.int().min(1).max(3_600_000).parse(deps.deadlineMs ?? 60_000);
  const sync = deps.syncRunner ?? createHindsightReplicaSyncRunner({ ...deps, repo: deps.replica, deadlineMs });
  const running = new Map<string, Promise<MemoryReplicaRunResult>>();
  const execute = (input: HindsightReplicaRunInput, rebuild: boolean) => {
    const key = input.run.lease.runId;
    const existing = running.get(key);
    if (existing) return existing;
    const promise = recover({ ...deps, deadlineMs }, { input, sync, rebuild }).finally(() => running.delete(key));
    running.set(key, promise);
    return promise;
  };
  return { run: (input) => execute(input, false), rebuild: (input) => execute(input, true) };
}

async function recover(deps: RecoveryDependencies, work: { input: HindsightReplicaRunInput; sync: HindsightReplicaSchedulerRunner; rebuild: boolean }): Promise<MemoryReplicaRunResult> {
  const context = captureContext(deps, work);
  context.request();
  let result = await (work.rebuild ? work.sync.rebuild(context.input) : work.sync.run(context.input));
  context.request();
  const stages = { ...context, checkpoint: result.checkpoint, nativeResultSupported: await nativeResultSupported(context),
    forceRetry: context.input.run.trigger === "manual" || context.input.run.trigger === "catch_up",
    derivedCompletion: deps.derivedCompletion ?? unavailableHindsightDerivedCompletion };
  const replayed = await replayPendingBank(stages);
  let records = await checkPendingDerived(stages, replayed);
  const ready = records.filter((record) => record.phase === "awaiting_pull" && record.lease !== null);
  if (ready.length > 0 || (records.length > 0 && records.every((record) => record.terminalAt !== null))) {
    result = await work.sync.run({ ...context.input, run: { ...context.input.run, kind: "incremental", predecessor: result.checkpoint } });
    context.request();
    const settled = new Map(confirmReflected(context, ready, result.checkpoint).map((record) => [record.sequence, record]));
    records = records.map((record) => settled.get(record.sequence) ?? record);
  }
  context.request();
  const summary = deps.pending.summary({ authorityEpochId: context.authority.epochId, bankId: context.input.bank.bankId });
  if (summary.pendingCount + summary.failedCount + summary.unknownCount > 0) {
    const unresolved = records.find((record) => !["completed", "superseded", "cancelled"].includes(record.phase) && record.diagnosticCode !== null);
    throw new Error(unresolved?.diagnosticCode ?? "HINDSIGHT_PENDING_REMAINS");
  }
  return result;
}

function captureContext(deps: RecoveryDependencies, work: { input: HindsightReplicaRunInput; sync: HindsightReplicaSchedulerRunner }): RecoveryContext {
  const authority = deps.authority.authorityEpoch();
  if (authority.providerId !== "hindsight") throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  if (work.input.expectedAuthority && (work.input.expectedAuthority.epochId !== authority.epochId
    || work.input.expectedAuthority.providerLineageId !== authority.providerLineageId)) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  const now = () => z.iso.datetime({ offset: true }).parse(deps.now?.() ?? new Date().toISOString());
  const deadlineAt = work.input.deadlineAt ?? new Date(Date.parse(now()) + (deps.deadlineMs ?? 60_000)).toISOString();
  const input = { ...work.input, bank: MemoryReplicaBankSchema.parse(work.input.bank),
    run: MemoryReplicaScheduledRunSchema.parse(work.input.run), deadlineAt, expectedAuthority: authority };
  const request = () => requestContext(deps, { input, authority, now });
  return { client: deps.client, pending: deps.pending, replica: deps.replica,
    beforeNativeDispatch: deps.beforeNativeDispatch,
    guard: { lease: input.run.lease, deadlineAt }, request, now, input, authority, sync: work.sync };
}

function requestContext(deps: RecoveryDependencies, input: { input: HindsightReplicaRunInput; authority: MemoryAuthorityEpoch; now: () => string }): HindsightCallContext {
  if (input.input.signal.aborted) throw new Error("HINDSIGHT_CANCELLED");
  deps.replica.leases.assert(input.input.run.lease);
  const remaining = Date.parse(input.input.deadlineAt ?? "") - Date.parse(input.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  const current = deps.authority.authorityEpoch();
  const binding = deps.projection.bankScope(input.input.bank.bankId);
  if (current.epochId !== input.authority.epochId || current.providerId !== input.authority.providerId || current.providerLineageId !== input.authority.providerLineageId
    || binding.kind !== input.input.bank.scope || binding.characterId !== input.input.bank.characterId) {
    throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  }
  return { timeoutMs: Math.min(deps.connection.requestTimeoutMs, remaining), signal: input.input.signal };
}

function confirmReflected(context: RecoveryContext, records: PendingMemoryRecord[], checkpoint: MemoryReplicaCheckpoint): PendingMemoryRecord[] {
  return records.map((record) => {
    context.request();
    // A caught-up journal that cannot reach the claimed fence invalidates that evidence, not another row's progress.
    const throughCursor = record.nativeResultReceipt?.result.native_through_cursor ?? record.derivedEvidence?.throughCursor;
    const change = throughCursor !== undefined && throughCursor <= checkpoint.endCursor
      ? { kind: "confirm" as const }
      : record.nativeResultReceipt ? { kind: "retry" as const, code: "HINDSIGHT_NATIVE_RESULT_INVALID" as const }
      : { kind: "retry_derived" as const, code: "HINDSIGHT_DERIVED_FENCE_INVALID" as const };
    try {
      return context.pending.progress({ record, guard: context.guard, change, checkpoint });
    } catch (error) {
      // A row's confirmation policy must not starve later ready rows. Reuse the
      // existing failure boundary so native proof survives and ownership/deadline
      // failures still abort the Bank run instead of becoming ordinary retries.
      return handlePendingFailure(context, record, error);
    }
  });
}

async function nativeResultSupported(context: RecoveryContext): Promise<boolean> {
  const manifest = await context.client.compatibility(context.request());
  context.request();
  if (manifest.provider.lineage !== context.authority.providerLineageId) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  const contract = manifest.contracts.native_results;
  // A D78 build keeps the same G1 factual contract. Requiring cutover verification here would make ordinary
  // pending writes depend on first-activation maintenance again, contrary to the accepted routine recovery rule.
  return (manifest.source_identity.compatibility_build === HINDSIGHT_NATIVE_RESULT_BUILD
      || manifest.source_identity.compatibility_build === HINDSIGHT_CURRENT_STATE_BUILD
      || manifest.source_identity.compatibility_build === HINDSIGHT_APPLICATION_STATE_BUILD
      || manifest.source_identity.compatibility_build === HINDSIGHT_TRANSITION_BUILD
      || manifest.source_identity.compatibility_build === HINDSIGHT_CONFIGURATION_BUILD
      || manifest.source_identity.compatibility_build === HINDSIGHT_TEMPLATE_BUILD)
    && contract?.version === HINDSIGHT_NATIVE_RESULT_VERSION && contract.support.state === "supported"
    && contract.support.reason === "all_contracts_available";
}
