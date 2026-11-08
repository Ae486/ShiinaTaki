/**
 * INPUT:  existing B5 leases/scheduler runners and the provider's on-demand pull/recovery requests
 * OUTPUT: serialized Bank work, whole multi-Bank capture ownership, renewable read leases and bounded write recovery
 * POS:    core/memory/hindsight — runtime lifetime adapter; existing B5 scheduling/backoff remains authoritative
 */
import { randomUUID } from "node:crypto";
import type { MemoryReplicaBank, MemoryReplicaLease, MemoryReplicaRunResult } from "@taki/shared";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightForegroundRunOwner, HindsightReplicaRunInput, HindsightReplicaSchedulerRunner } from "./hindsight-replica-sync-runner.ts";
import type { HindsightMemoryWriteAdvance } from "./hindsight-memory-write-context.ts";
import { hindsightApplicationDeadline } from "./hindsight-application-body-transfer.ts";
import { replicaErrorCode, replicaResetRequired } from "./hindsight-replica-errors.ts";
import type { CanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";

interface Dependencies {
  replica: HindsightApplicationReplicaRepo;
  sync: HindsightReplicaSchedulerRunner;
  recovery: HindsightReplicaSchedulerRunner;
  bank(bankId: string): MemoryReplicaBank;
  assertConnection(): void;
  onRecovered(input: HindsightMemoryWriteAdvance): Promise<void>;
  now?: () => string;
  workFence?: CanonicalLocalWriteFence;
}
export interface HindsightRuntimeSynchronizeInput {
  bankId: string;
  context: HindsightCallContext;
  /** Foreground reads and receipt-Bank activation preparation wait for completion; other operations keep bounded mode. */
  mode?: "foreground";
}
interface OnDemandInput extends HindsightRuntimeSynchronizeInput {
  ownerId: string; signal: AbortSignal; previous?: Promise<unknown>; withPending: boolean;
}

export function createHindsightRuntimeBankService(deps: Dependencies) {
  const controller = new AbortController(); const ownerId = `hindsight-runtime:${randomUUID()}`;
  const active = new Set<Promise<unknown>>(); const banks = new Map<string, Promise<unknown>>();
  const own = <T>(action: () => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) return Promise.reject(new Error("HINDSIGHT_CANCELLED"));
    let task: Promise<T>;
    try { task = deps.workFence ? deps.workFence.admit(action) : action(); } catch (error) { return Promise.reject(error); }
    active.add(task); void task.then(() => active.delete(task), () => active.delete(task)); return task;
  };
  const track = <T>(bankId: string, action: () => Promise<T>): Promise<T> => {
    const previous = banks.get(bankId); const task = own(action);
    // A cancelled waiter settles immediately, but its queue position still
    // represents any earlier active owner for the next arriving caller.
    const barrier = Promise.allSettled(previous ? [previous, task] : [task]);
    banks.set(bankId, barrier);
    void barrier.then(() => { if (banks.get(bankId) === barrier) banks.delete(bankId); });
    return task;
  };
  const scheduled = (input: HindsightReplicaRunInput, reset: boolean) => track(input.bank.bankId, () => {
    const signal = AbortSignal.any([controller.signal, input.signal]);
    return recover(deps, { ...input, signal, foreground: undefined }, reset);
  });
  const onDemand = (input: HindsightRuntimeSynchronizeInput, withPending: boolean) => {
    const previous = banks.get(input.bankId);
    const signal = input.context.signal ? AbortSignal.any([controller.signal, input.context.signal]) : controller.signal;
    return track(input.bankId, () => runOnDemand(deps, { ...input, signal, ownerId, previous, withPending }));
  };
  const settle = async () => { while (active.size > 0) await Promise.allSettled([...active]); };
  return { capture: own,
    synchronize: (input: HindsightRuntimeSynchronizeInput) => onDemand(input, false),
    recover: (input: { bankId: string; context: HindsightCallContext }) => onDemand(input, true),
    runner: { run: (input: HindsightReplicaRunInput) => scheduled(input, false),
      rebuild: (input: HindsightReplicaRunInput) => scheduled(input, true) } satisfies HindsightReplicaSchedulerRunner,
    stop: () => { controller.abort(); return settle(); }, settle };
}
export type HindsightRuntimeBankService = ReturnType<typeof createHindsightRuntimeBankService>;

async function runOnDemand(deps: Dependencies, input: OnDemandInput): Promise<void> {
  const bounded = input.mode !== "foreground" || input.withPending;
  const request = bounded ? hindsightApplicationDeadline({ ...input.context, signal: input.signal }) : () => {
    if (input.signal.aborted) throw new Error("HINDSIGHT_CANCELLED");
    return { ...input.context, signal: input.signal };
  };
  request(); if (input.previous) await waitForPreviousBank(input.previous, request(), bounded); request(); deps.assertConnection();
  const remaining = request().timeoutMs;
  const lease = deps.replica.leases.acquire({ bankId: input.bankId, ownerId: input.ownerId,
    durationMs: bounded ? Math.min(3_600_000, remaining + 1000) : remaining + 1000 });
  let foreground: HindsightForegroundRunOwner | undefined;
  let releaseFailure: unknown;
  try {
    foreground = bounded ? undefined : foregroundOwner(deps, { lease, context: request() });
    const run: HindsightReplicaRunInput = { bank: deps.bank(input.bankId), signal: input.signal, foreground,
      deadlineAt: bounded ? new Date(Date.parse(deps.now?.() ?? new Date().toISOString()) + remaining).toISOString() : undefined,
      run: { lease, kind: deps.replica.checkpoint(input.bankId) ? "incremental" : "full", trigger: "catch_up",
        predecessor: deps.replica.nativeCheckpoint(input.bankId) ?? null } };
    await (input.withPending ? recoverOnDemand(deps, run) : pull(deps, run)); request(); deps.assertConnection();
  } finally {
    try { deps.replica.leases.release(foreground?.current() ?? lease); }
    catch (error) { if (replicaErrorCode(error) !== "HINDSIGHT_REPLICA_LEASE_LOST") releaseFailure = error; }
  }
  if (releaseFailure !== undefined) throw releaseFailure;
}

function foregroundOwner(deps: Dependencies, input: {
  lease: MemoryReplicaLease; context: HindsightCallContext;
}): HindsightForegroundRunOwner {
  let lease = input.lease;
  // The sync runner must call this only after its guarded Bank/authority publication check.
  // This owner manages cancellation and the exact lease; it is not an authority credential.
  return { current: () => lease, request: () => {
    if (input.context.signal?.aborted) throw new Error("HINDSIGHT_CANCELLED");
    deps.replica.leases.assert(lease);
    const remaining = Date.parse(lease.expiresAt) - Date.parse(deps.now?.() ?? new Date().toISOString());
    if (remaining < input.context.timeoutMs) lease = deps.replica.leases.renew({ lease, durationMs: input.context.timeoutMs + 1000 });
    return input.context;
  } };
}

async function waitForPreviousBank(previous: Promise<unknown>, context: HindsightCallContext, bounded: boolean): Promise<void> {
  // A bounded queued call keeps its deadline; foreground waiters only cancel. The preceding call
  // remains owned by the service; timing out this waiter never acquires a lease
  // or attaches a continuation that could later enter SQLite.
  let rejectWait: (error: Error) => void = () => undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
  const abort = () => rejectWait(new Error("HINDSIGHT_CANCELLED"));
  const timer = bounded ? setTimeout(() => rejectWait(new Error("HINDSIGHT_TIMEOUT")), context.timeoutMs) : undefined;
  context.signal?.addEventListener("abort", abort, { once: true });
  if (context.signal?.aborted) abort();
  try { await Promise.race([previous.catch(() => undefined), interrupted]); }
  finally { clearTimeout(timer); context.signal?.removeEventListener("abort", abort); }
}

async function recoverOnDemand(deps: Dependencies, input: HindsightReplicaRunInput): Promise<MemoryReplicaRunResult> {
  try { return await recover(deps, input, false); }
  catch (error) {
    if (input.signal.aborted || !replicaResetRequired(error)) throw error;
    // Scheduled work already has this reset boundary in B5's executor. Direct
    // writes need the same bounded retry with the original lease and deadline.
    return recover(deps, { ...input, run: { ...input.run, kind: "full",
      predecessor: deps.replica.nativeCheckpoint(input.bank.bankId) ?? null } }, true);
  }
}

async function pull(deps: Dependencies, input: HindsightReplicaRunInput): Promise<MemoryReplicaRunResult> {
  try { return await deps.sync.run(input); }
  catch (error) {
    if (input.signal.aborted || !replicaResetRequired(error)) throw error;
    return deps.sync.rebuild({ ...input, run: { ...input.run, kind: "full", predecessor: deps.replica.nativeCheckpoint(input.bank.bankId) ?? null } });
  }
}

async function recover(deps: Dependencies, input: HindsightReplicaRunInput, reset: boolean): Promise<MemoryReplicaRunResult> {
  if (input.signal.aborted) throw new Error("HINDSIGHT_CANCELLED"); deps.assertConnection();
  let result: MemoryReplicaRunResult | undefined; let pendingError: unknown;
  try { result = await (reset ? deps.recovery.rebuild(input) : deps.recovery.run(input)); }
  catch (error) {
    const code = replicaErrorCode(error);
    if (!["HINDSIGHT_PENDING_REMAINS", "HINDSIGHT_PENDING_OPERATION_FAILED", "HINDSIGHT_PENDING_OUTCOME_UNKNOWN",
      "HINDSIGHT_PENDING_OPERATION_CANCELLED", "HINDSIGHT_PENDING_SUPERSEDED"].includes(code)) throw error;
    pendingError = error;
  }
  if (input.signal.aborted) throw new Error("HINDSIGHT_CANCELLED"); deps.assertConnection();
  const remaining = Date.parse(input.deadlineAt ?? input.run.lease.expiresAt) - Date.parse(deps.now?.() ?? new Date().toISOString());
  await deps.onRecovered({ bankId: input.bank.bankId, context: { timeoutMs: remaining, signal: input.signal },
    refresh: async () => { result = await deps.sync.run({ ...input,
      run: { ...input.run, kind: "incremental", predecessor: deps.replica.nativeCheckpoint(input.bank.bankId) ?? null } }); } });
  if (pendingError) throw pendingError;
  const checkpoint = deps.replica.nativeCheckpoint(input.bank.bankId); if (!checkpoint) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  return { checkpoint, observedCursor: Math.max(checkpoint.endCursor, result?.observedCursor ?? checkpoint.endCursor) };
}
