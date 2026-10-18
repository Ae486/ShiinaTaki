/**
 * INPUT:  the lifecycle deps the boot composition supplies (database, live config + Secret Catalog, client factory, published
 *         runtime view, binding snapshot and replace seam, logger)
 * OUTPUT: createHindsightLifecycleService() — the local reads the lifecycle kinds, status and automatic trigger share, plus
 *         bounded provision/revalidate calls (setup deadline -> HINDSIGHT_TIMEOUT, stop -> HINDSIGHT_LIFECYCLE_INTERRUPTED)
 *         and a stop that aborts and awaits every in-flight call
 * POS:    core/memory/hindsight-lifecycle — Stage 2c producer owner; owns no timers beyond a call deadline, no second ledger
 */
import type { MemoryBankProducerRef, MemoryConnectionProducerRef } from "@taki/shared";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import { hindsightError } from "../hindsight/hindsight-errors.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { MemoryOperationsRuntime } from "../operations/memory-operation-contract.ts";
import type { HindsightLifecycleCall, HindsightLifecycleDeps } from "./hindsight-lifecycle-context.ts";
import { provisionHindsightBank, type HindsightBankPhase, type HindsightProvisionOutcome } from "./hindsight-lifecycle-provision.ts";
import {
  hindsightRevalidateBlocker, readHindsightBankFacts, readHindsightLifecycleLive, readHindsightReviewedFingerprint, type HindsightBankFacts, type HindsightLifecycleLive,
  type HindsightReadyLive, type HindsightRevalidateBlocker,
} from "./hindsight-lifecycle-reads.ts";
import { revalidateHindsightConnection, type HindsightConnectionPhase, type HindsightRevalidateOutcome } from "./hindsight-lifecycle-revalidate.ts";

export const HINDSIGHT_LIFECYCLE_FAMILY = "hindsight-lifecycle";

export interface HindsightLifecycleService {
  /** The durable marker; throws on an integrity failure. */
  authority(): MemoryAuthoritySelection;
  /** Throws for a Character id outside the Bank identity bounds. */
  bankFacts(input: { epochId: string; characterId: string }): HindsightBankFacts;
  live(): HindsightLifecycleLive;
  runtime(): MemoryOperationsRuntime | null;
  /** The Stage 4/5 change a revalidation of this live connection would refuse, or null. */
  revalidateBlocker(live: HindsightReadyLive, epochId: string): HindsightRevalidateBlocker | null;
  /** Whether the B3 snapshot reviewed this fingerprint and admission evidence exists for it (restart classification). */
  revalidated(input: { epochId: string; fingerprint: string }): boolean;
  provision(ref: MemoryBankProducerRef, checkpoint: (phase: HindsightBankPhase) => void, operationId?: string): Promise<HindsightProvisionOutcome>;
  revalidate(ref: MemoryConnectionProducerRef, checkpoint: (phase: HindsightConnectionPhase) => void): Promise<HindsightRevalidateOutcome>;
  stopRequested(): boolean;
  stop(): Promise<void>;
  retireEpoch?(epochId: string): void;
}

interface State { deps: HindsightLifecycleDeps; stopping: boolean;
  calls: Map<AbortController, { epochId: string; promise: Promise<unknown> }>; retired: Set<string> }

export function createHindsightLifecycleService(deps: HindsightLifecycleDeps): HindsightLifecycleService {
  const state: State = { deps, stopping: false, calls: new Map(), retired: new Set() };
  const runtimeFor = (epochId: string) => { const runtime = deps.runtime(); return runtime?.epochId === epochId ? runtime : null; };
  return {
    authority: () => readMemoryAuthoritySelection(deps.db),
    bankFacts: (input) => readHindsightBankFacts(deps.db, input),
    live: () => readHindsightLifecycleLive(deps),
    runtime: deps.runtime,
    revalidateBlocker: (live, epochId) => hindsightRevalidateBlocker(deps.db, { live, runtime: runtimeFor(epochId) }),
    revalidated: (input) => revalidated(deps, input),
    provision: (ref, checkpoint, operationId) => bounded(state, ref.admittedEpochId,
      (call) => provisionHindsightBank(deps, { ref, operationId, call: { ...call, checkpoint } })),
    revalidate: (ref, checkpoint) => bounded(state, ref.epochId, (call) => revalidateHindsightConnection(deps, { ref, call: { ...call, checkpoint } })),
    retireEpoch: (epochId) => {
      state.retired.add(epochId);
      for (const [controller, call] of state.calls) if (call.epochId === epochId) controller.abort(new Error("HINDSIGHT_LIFECYCLE_INTERRUPTED"));
    },
    stopRequested: () => state.stopping,
    stop: async () => {
      state.stopping = true;
      for (const controller of state.calls.keys()) controller.abort(new Error("HINDSIGHT_LIFECYCLE_INTERRUPTED"));
      await Promise.allSettled([...state.calls.values()].filter((call) => !state.retired.has(call.epochId)).map((call) => call.promise));
    },
  };
}

/** Unreadable or foreign evidence proves nothing; restart classification then stays outcome_unknown. */
function revalidated(deps: HindsightLifecycleDeps, input: { epochId: string; fingerprint: string }): boolean {
  try {
    return readHindsightReviewedFingerprint(deps.db) === input.fingerprint
      && createHindsightRuntimeAdmissionRepo(deps.db).read({ authorityEpochId: input.epochId, configFingerprint: input.fingerprint }) !== undefined;
  } catch { return false; }
}

/** The abort reason, not the transport's own cancellation error, names why a call ended early. */
async function bounded<T>(state: State, epochId: string, run: (call: Omit<HindsightLifecycleCall<string>, "checkpoint">) => Promise<T>): Promise<T> {
  if (state.stopping || state.retired.has(epochId)) throw new Error("HINDSIGHT_LIFECYCLE_INTERRUPTED");
  const live = readHindsightLifecycleLive(state.deps);
  const controller = new AbortController();
  const deadline = live.state === "ready"
    ? setTimeout(() => controller.abort(hindsightError("HINDSIGHT_TIMEOUT")), live.projection.setupTimeoutMs) : undefined;
  const promise = run({ signal: controller.signal });
  controller.signal.addEventListener("abort", () => clearTimeout(deadline), { once: true });
  state.calls.set(controller, { epochId, promise });
  try { return await promise; }
  catch (error) { throw controller.signal.aborted ? controller.signal.reason : error; }
  finally { clearTimeout(deadline); state.calls.delete(controller); }
}
