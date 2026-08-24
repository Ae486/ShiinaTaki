import type { EffectLifecycle, UsageRecord } from "@taki/shared";
import type { EffectIntentInput, EffectRepo, EffectSettlementInput } from "../db/effect-repo.ts";

/** Core-owned bracket for every uncertain subordinate operation. Domain adapters remain execution authorities. */
export interface EffectLifecycleService {
  prepare(input: EffectIntentInput): EffectLifecycle;
  settle(input: EffectSettlementInput): { effect?: EffectLifecycle; duplicate: boolean; stale: boolean; usage?: UsageRecord };
  get(effectId: string): EffectLifecycle | undefined;
  unfinished(runId?: string): EffectLifecycle[];
}

export function createEffectLifecycleService(repo: EffectRepo): EffectLifecycleService {
  return { prepare: (input) => repo.prepareIntent(input), settle: (input) => repo.settle(input), get: (id) => repo.get(id), unfinished: (runId) => repo.listUnfinished(runId) };
}
