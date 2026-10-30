/**
 * INPUT:  EffectRepo, optional Run/Attempt dispatch guard, and optional durable observability sink
 * OUTPUT: guarded Effect lifecycle facade with isolated append-only observer recording
 * POS:    core/harness — common Effect authority adapter used by model, tool, Host, MCP, Approval, and Memory paths
 */
import type { EffectLifecycle, RunEvent, UsageRecord } from "@taki/shared";
import type { EffectIntentInput, EffectRepo, EffectSettlementInput, EffectWaitingInput } from "../db/effect-repo.ts";
import type { RunEventRepo } from "../db/run-event-repo.ts";
import type { RunEventLiveBus } from "../db/run-event-live.ts";

/** Core-owned bracket for every uncertain subordinate operation. Domain adapters remain execution authorities. */
export interface EffectLifecycleService {
  prepareWaiting?(input: EffectWaitingInput): EffectLifecycle;
  settleWaiting?(input: Parameters<EffectRepo["settleWaiting"]>[0]): { effect: EffectLifecycle; stale: boolean; duplicate: boolean };
  commitIntent?(input: Parameters<EffectRepo["commitIntent"]>[0]): { effect: EffectLifecycle; stale: boolean; duplicate: boolean };
  prepare(input: EffectIntentInput): EffectLifecycle;
  settle(input: EffectSettlementInput): { effect?: EffectLifecycle; duplicate: boolean; stale: boolean; usage?: UsageRecord };
  get(effectId: string): EffectLifecycle | undefined;
  unfinished(runId?: string): EffectLifecycle[];
  list?(runId: string): EffectLifecycle[];
  record?(event: Omit<RunEvent, "eventId" | "seq">): void;
}

export function createEffectLifecycleService(
  repo: EffectRepo,
  guard?: (runId: string, attemptId: string) => boolean,
  observability?: { eventRepo: RunEventRepo; liveBus?: RunEventLiveBus },
): EffectLifecycleService {
  const allowed = (runId: string, attemptId: string) => {
    if (guard && !guard(runId, attemptId)) throw new Error("RUN_EFFECT_DISPATCH_REFUSED");
  };
  return { prepare: (input) => { allowed(input.runId, input.attemptId); return repo.prepareIntent(input); }, prepareWaiting: (input) => { allowed(input.runId, input.attemptId); return repo.prepareWaiting(input); }, settleWaiting: (input) => repo.settleWaiting(input), commitIntent: (input) => { allowed(input.runId, input.attemptId); return repo.commitIntent(input); }, settle: (input) => repo.settle(input), get: (id) => repo.get(id), unfinished: (runId) => repo.listUnfinished(runId), list: (runId) => repo.list(runId), record: observability ? (event) => { try { const committed = observability.eventRepo.appendMany([event]); observability.liveBus?.publish(committed); } catch { /* observer evidence cannot alter execution correctness */ } } : undefined };
}
