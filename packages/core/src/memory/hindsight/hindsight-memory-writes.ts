/**
 * INPUT:  provider writes, current Hindsight routing and the existing serialized Bank recovery service
 * OUTPUT: durable original intents, truthful queued results and scheduler retry handoff for native/policy completion
 * POS:    core/memory/hindsight — actual foreground write gateway; shutdown cancels and settles its own continuations
 */
import { PendingMemoryOperationSchema, REPLICA_RETRY_DELAYS_MS, type MutationRequest, type RetainRequest } from "@taki/shared";
import type { MemoryProviderCallContext } from "../memory-provider.ts";
import { applicationCommandJsonBytes, applicationCommandJsonValue } from "../../db/hindsight-application-command-contract.ts";
import { captureHindsightMemoryWrite, type HindsightMemoryWriteDeps, type HindsightMemoryWriteAdvance } from "./hindsight-memory-write-context.ts";
import { admitHindsightMemoryWrite } from "./hindsight-memory-write-admission.ts";
import { hindsightMemoryMutationPending, hindsightMemoryMutationResult, hindsightMemoryRetainResult, hindsightMemoryWriteChild } from "./hindsight-memory-write-result.ts";
import { advanceHindsightMemoryWrites } from "./hindsight-memory-write-recovery.ts";
import { hindsightAvailabilityFailure } from "./hindsight-memory-provider-context.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";
import type { HindsightReplicaScheduler } from "./hindsight-replica-scheduler.ts";

export function createHindsightMemoryWrites(deps: HindsightMemoryWriteDeps) {
  const controller = new AbortController(); const active = new Set<Promise<unknown>>();
  let retryScheduler: Pick<HindsightReplicaScheduler, "requestRetry"> | undefined;
  const signal = (external?: AbortSignal) => {
    if (controller.signal.aborted) throw new Error("MEMORY_OPERATION_CANCELLED");
    return external ? AbortSignal.any([controller.signal, external]) : controller.signal;
  };
  const track = <T>(action: () => Promise<T>): Promise<T> => {
    let task: Promise<T>;
    try { task = action(); } catch (error) { return Promise.reject(error); }
    active.add(task); void task.then(() => active.delete(task), () => active.delete(task)); return task;
  };
  const execute = async (call: MemoryProviderCallContext, raw: unknown) => {
    const operation = PendingMemoryOperationSchema.parse(raw);
    if (!sameApplicationValue(operation, raw)) throw new Error("MEMORY_INVALID_REQUEST");
    // Freeze before the first asynchronous recovery step without structuredClone's
    // engine-dependent recursion limit. The old native admission quotas still apply.
    const frozen = PendingMemoryOperationSchema.parse(applicationCommandJsonValue(applicationCommandJsonBytes(operation)));
    const context = captureHindsightMemoryWrite(deps, { call: { ...call, signal: signal(call.signal) }, operation: frozen });
    const job = admitHindsightMemoryWrite(context);
    if (!job.terminal) {
      try { await deps.recover({ bankId: job.identity.key.bankId, context: context.request() }); }
      catch (error) {
        context.assertActive();
        if (!pendingRecoveryFailure(error)) throw error;
      }
    }
    context.assertActive(); const current = deps.journal.get(job.identity.key);
    if (!current) throw new Error("MEMORY_INTEGRITY_ERROR");
    if (!current.terminal && retryScheduler) {
      const child = hindsightMemoryWriteChild(deps, current);
      const dueAt = child?.nextRetryAt ?? new Date(Date.parse(deps.now?.() ?? new Date().toISOString()) + REPLICA_RETRY_DELAYS_MS[0]).toISOString();
      retryScheduler.requestRetry(current.identity.key.bankId, dueAt);
    }
    return current;
  };
  const settle = async () => { while (active.size > 0) await Promise.allSettled([...active]); };
  return {
    // The subsystem constructs the scheduler after the write/recovery cycle; both share its lifetime.
    setRetryScheduler: (scheduler: Pick<HindsightReplicaScheduler, "requestRetry">) => { retryScheduler = scheduler; },
    retain: (call: MemoryProviderCallContext, request: RetainRequest) => track(async () =>
      hindsightMemoryRetainResult(deps, await execute(call, { kind: "retain", request, zeroResultAllowed: true }))),
    mutate: (call: MemoryProviderCallContext, request: MutationRequest) => track(async () =>
      hindsightMemoryMutationResult(deps, await execute(call, { kind: "mutation", request }))),
    advanceBank: (input: HindsightMemoryWriteAdvance) => track(() => advanceHindsightMemoryWrites(deps, {
      ...input, context: { ...input.context, signal: signal(input.context.signal) },
    })),
    mutationOverlays: (bankId: string) => { signal(); return mutationOverlays(deps, bankId); },
    ownsPendingOperation: (operationId: string) => deps.journal.ownsNativeMutation({ authorityEpochId: deps.epochId, operationId }),
    stop: () => { controller.abort(); return settle(); }, settle,
  };
}
export type HindsightMemoryWrites = ReturnType<typeof createHindsightMemoryWrites>;

function mutationOverlays(deps: HindsightMemoryWriteDeps, bankId: string) {
  const result = []; let afterSequence = 0;
  const namespace = deps.replica.checkpoint(bankId)?.namespace;
  if (!namespace) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  for (;;) {
    const jobs = deps.journal.pending({ authorityEpochId: deps.epochId, bankId, namespace, afterSequence });
    if (jobs.length === 0) break;
    for (const job of jobs) {
      afterSequence = job.sequence;
      if (job.identity.operation.kind === "mutation") result.push(hindsightMemoryMutationPending(deps, job));
    }
  }
  return result;
}

function pendingRecoveryFailure(error: unknown): boolean {
  if (hindsightAvailabilityFailure(error)) return true;
  return error instanceof Error && ["HINDSIGHT_PENDING_REMAINS", "HINDSIGHT_PENDING_OPERATION_FAILED", "HINDSIGHT_PENDING_OUTCOME_UNKNOWN",
    "HINDSIGHT_NATIVE_RESULT_UNAVAILABLE", "HINDSIGHT_PENDING_OPERATION_CANCELLED", "HINDSIGHT_PENDING_SUPERSEDED"].includes(error.message);
}
