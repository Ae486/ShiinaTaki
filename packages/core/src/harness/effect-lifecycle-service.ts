import type { EffectLifecycle, UsageRecord } from "@taki/shared";
import type { EffectIntentInput, EffectRepo, EffectSettlementInput, EffectWaitingInput } from "../db/effect-repo.ts";

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
}

export function createEffectLifecycleService(repo: EffectRepo, guard?: (runId: string, attemptId: string) => boolean): EffectLifecycleService {
  const allowed = (runId: string, attemptId: string) => {
    if (guard && !guard(runId, attemptId)) throw new Error("RUN_EFFECT_DISPATCH_REFUSED");
  };
  return { prepare: (input) => { allowed(input.runId, input.attemptId); return repo.prepareIntent(input); }, prepareWaiting: (input) => { allowed(input.runId, input.attemptId); return repo.prepareWaiting(input); }, settleWaiting: (input) => repo.settleWaiting(input), commitIntent: (input) => { allowed(input.runId, input.attemptId); return repo.commitIntent(input); }, settle: (input) => repo.settle(input), get: (id) => repo.get(id), unfinished: (runId) => repo.listUnfinished(runId), list: (runId) => repo.list(runId) };
}
