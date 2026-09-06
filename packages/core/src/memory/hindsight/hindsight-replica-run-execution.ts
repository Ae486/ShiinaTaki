/**
 * INPUT:  one durable scheduler claim, a replica runner, and a bounded cancellation budget
 * OUTPUT: fenced completion/reset settlement and immediate lease revocation on stop or timeout
 * POS:    core/memory/hindsight — execution lifetime; late/uncooperative adapters cannot publish after cancellation
 */
import type { MemoryReplicaBank, MemoryReplicaErrorCode, MemoryReplicaRunResult, MemoryReplicaScheduledRun } from "@taki/shared";
import type { HindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import type { HindsightReplicaLeaseRepo } from "../../db/hindsight-replica-lease-repo.ts";
import type { HindsightReplicaSchedulerRunner } from "./hindsight-replica-sync-runner.ts";
import { replicaErrorCode, replicaOwnershipLost, replicaResetRequired } from "./hindsight-replica-errors.ts";

export interface ReplicaRunExecution {
  completion: Promise<void>;
  cancel(): void;
}
interface ExecutionInput {
  bank: MemoryReplicaBank; run: MemoryReplicaScheduledRun; repo: HindsightReplicaSchedulerRepo;
  leases: HindsightReplicaLeaseRepo; runner: HindsightReplicaSchedulerRunner; timeoutMs: number;
}
interface ExecutionState {
  input: ExecutionInput; run: MemoryReplicaScheduledRun; controller: AbortController;
  cancelled: boolean; settled: boolean; finished: boolean; cancellationFailure: unknown;
}

export function executeHindsightReplicaRun(input: ExecutionInput): ReplicaRunExecution {
  const state: ExecutionState = { input, run: input.run, controller: new AbortController(),
    cancelled: false, settled: false, finished: false, cancellationFailure: undefined };
  let rejectCancellation: (reason: Error) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const cancel = (code: MemoryReplicaErrorCode) => {
    if (state.finished || state.cancelled) return;
    state.cancelled = true;
    try { failRun(state, code); }
    catch (error) { state.cancellationFailure = error; }
    // Revoke the lease synchronously before an ignored transport abort can return a late response.
    finally { state.controller.abort(); rejectCancellation(new Error(code)); }
  };
  const timer = setTimeout(() => cancel("HINDSIGHT_TIMEOUT"), input.timeoutMs);
  const completion = settleExecution(state, Promise.race([perform(state), cancellation]))
    .finally(() => { state.finished = true; clearTimeout(timer); });
  return { completion, cancel: () => cancel("HINDSIGHT_CANCELLED") };
}

async function perform(state: ExecutionState): Promise<MemoryReplicaRunResult> {
  const { input } = state;
  try { return await input.runner.run({ bank: input.bank, run: state.run, signal: state.controller.signal }); }
  catch (error) {
    if (state.controller.signal.aborted || !replicaResetRequired(error)) throw error;
    state.run = input.repo.promoteToFull(state.run);
    return input.runner.rebuild({ bank: input.bank, run: state.run, signal: state.controller.signal });
  }
}

async function settleExecution(state: ExecutionState, result: Promise<MemoryReplicaRunResult>): Promise<void> {
  let failure: unknown;
  try {
    const value = await result;
    if (!state.cancelled) {
      state.input.repo.succeed({ run: state.run, result: value });
      state.settled = true;
    }
  } catch (error) {
    if (!state.cancelled && !replicaOwnershipLost(error)) {
      try { failRun(state, replicaErrorCode(error)); }
      catch (cause) { failure = cause; }
    }
  }
  if (state.cancelled) failure = state.cancellationFailure;
  if (!state.settled) {
    try { state.input.leases.release(state.run.lease); }
    catch (error) { if (!replicaOwnershipLost(error)) failure ??= error; }
  }
  if (failure !== undefined) throw failure;
}

function failRun(state: ExecutionState, errorCode: MemoryReplicaErrorCode): void {
  try {
    state.input.repo.fail({ run: state.run, errorCode });
    state.settled = true;
  } catch (error) {
    if (!replicaOwnershipLost(error)) {
      // A status-write failure must still retire this lease before cancellation returns to its caller.
      state.input.leases.release(state.run.lease);
      throw error;
    }
  }
}
