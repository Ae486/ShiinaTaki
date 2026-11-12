/**
 * INPUT:  Utility task labels, durable maintenance references and Run-owned provider call callbacks
 * OUTPUT: immutable AsyncLocalStorage ownership captured at the model boundary
 * POS:    core/observability — process-local model-call ownership only; no persistence or payload data
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { EffectLifecycle, MaintenanceOperationRef } from "@taki/shared";

export type ModelUsageOwner =
  | Readonly<{ owner: "auxiliary"; taskId: string; label: string; operation?: MaintenanceOperationRef }>
  | Readonly<{ owner: "maintenance"; operation: MaintenanceOperationRef }>
  | Readonly<{ owner: "run"; effect?: EffectLifecycle }>;

const owners = new AsyncLocalStorage<ModelUsageOwner>();
const RUN_OWNER = Object.freeze({ owner: "run" } as const);

export function withAuxiliaryUsageTask<T>(label: string, task: () => Promise<T>): Promise<T> {
  const parent = owners.getStore();
  const operation = parent && parent.owner !== "run" ? parent.operation : undefined;
  const owner = Object.freeze({ owner: "auxiliary" as const, taskId: randomUUID(), label,
    ...(operation ? { operation } : {}) });
  return owners.run(owner, task);
}

export function withRunUsageOwner<T>(operation: () => T, effect?: EffectLifecycle): T {
  return owners.run(effect ? Object.freeze({ owner: "run", effect }) : RUN_OWNER, operation);
}

export function withMaintenanceUsageOwner<T>(operation: MaintenanceOperationRef, task: () => T): T {
  const current = owners.getStore();
  const owner = current?.owner === "auxiliary" ? { ...current, operation: Object.freeze({ ...operation }) }
    : { owner: "maintenance" as const, operation: Object.freeze({ ...operation }) };
  return owners.run(Object.freeze(owner), task);
}

export function currentModelUsageOwner(): ModelUsageOwner | undefined {
  return owners.getStore();
}
