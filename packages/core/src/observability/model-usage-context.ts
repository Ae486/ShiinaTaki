/**
 * INPUT:  Utility task labels and Run-owned provider call callbacks
 * OUTPUT: immutable AsyncLocalStorage ownership captured at the model boundary
 * POS:    core/observability — process-local model-call ownership only; no persistence or payload data
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { EffectLifecycle } from "@taki/shared";

export type ModelUsageOwner =
  | Readonly<{ owner: "auxiliary"; taskId: string; label: string }>
  | Readonly<{ owner: "run"; effect?: EffectLifecycle }>;

const owners = new AsyncLocalStorage<ModelUsageOwner>();
const RUN_OWNER = Object.freeze({ owner: "run" } as const);

export function withAuxiliaryUsageTask<T>(label: string, task: () => Promise<T>): Promise<T> {
  const owner = Object.freeze({ owner: "auxiliary" as const, taskId: randomUUID(), label });
  return owners.run(owner, task);
}

export function withRunUsageOwner<T>(operation: () => T, effect?: EffectLifecycle): T {
  return owners.run(effect ? Object.freeze({ owner: "run", effect }) : RUN_OWNER, operation);
}

export function currentModelUsageOwner(): ModelUsageOwner | undefined {
  return owners.getStore();
}
