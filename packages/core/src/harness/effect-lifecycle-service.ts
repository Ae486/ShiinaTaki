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
}

export function createEffectLifecycleService(repo: EffectRepo): EffectLifecycleService {
  return { prepare: (input) => repo.prepareIntent(input), prepareWaiting: (input) => repo.prepareWaiting(input), settleWaiting: (input) => repo.settleWaiting(input), commitIntent: (input) => repo.commitIntent(input), settle: (input) => repo.settle(input), get: (id) => repo.get(id), unfinished: (runId) => repo.listUnfinished(runId) };
}
