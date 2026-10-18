/**
 * INPUT:  one original plan and the current local epoch/configuration, executor and generic operation owners
 * OUTPUT: shared read-only recovery admission predicate for both operator actions and actual submission
 * POS:    template recovery guard — never claims, renews, dispatches or rewrites a terminal generic outcome
 */
import type { MemoryTemplateStatus } from "@taki/shared";
import { createMemoryOperationRepo } from "../../../db/memory-operation-repo.ts";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { EXCLUSIVE_MEMORY_FAMILIES, MemoryOperationRefusal } from "../../operations/memory-operation-contract.ts";
import { activeTemplateHold, readTemplateHold, readTemplatePlan, readTemplatePublication } from "./template-execution-reads.ts";
import { readTemplateExecutor } from "./template-executor-store.ts";
import { assertTemplateLocalPlan, type TemplateGuardDependencies } from "./template-plan-guard.ts";
import { readTemplateSelectionIdentity } from "./template-runtime-selection.ts";

type Dependencies = TemplateGuardDependencies & { bootId: string; now(): string; boundSelectionIdentity(): string | null };

export function assertTemplateRecovery(deps: Dependencies, planId: string): void {
  const plan = readTemplatePlan(deps.db, planId); const hold = readTemplateHold(deps.db, planId);
  if (!hold || hold.state === "cancelled") throw new Error("MEMORY_TEMPLATE_CONFLICT");
  if (hold.state === "quarantined") throw new Error("MEMORY_TEMPLATE_QUARANTINED");
  const selected = readMemoryAuthoritySelection(deps.db);
  if (selected.mode !== "hindsight" || selected.epochId !== plan.guard.epochId) stale();
  const active = activeTemplateHold(deps.db, plan.guard.epochId);
  if (active && active.planId !== planId) throw new Error("MEMORY_TEMPLATE_HOLD");
  const publication = readTemplatePublication(deps.db, planId);
  if (publication) {
    if (readTemplateSelectionIdentity(deps.db, plan.guard.epochId) !== publication.selectionIdentity) stale();
    if (deps.boundSelectionIdentity() === publication.selectionIdentity) throw new Error("MEMORY_TEMPLATE_ALREADY_BOUND");
  } else if (active?.planId !== planId) stale();
  const lease = readTemplateExecutor(deps.db, planId);
  if (lease.token && lease.bootId === deps.bootId && lease.deadlineMs > Date.parse(deps.now())) throw new Error("MEMORY_TEMPLATE_LEASE_LOST");
  assertTemplateLocalPlan(deps, { plan, publication: publication ?? undefined });
  const operations = createMemoryOperationRepo(deps.db);
  for (const family of [...EXCLUSIVE_MEMORY_FAMILIES, ...plan.banks.map((bank) => `replica:${bank.identity.target.bank_id}`)]) {
    const operation = operations.activeInFamily(family);
    if (operation) throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", operation.operationId);
  }
}

export function templateRecoveryAction(deps: Dependencies, planId: string | null): Pick<MemoryTemplateStatus, "recoverPlanId" | "recoverUnavailableReason"> {
  if (!planId) return { recoverPlanId: null, recoverUnavailableReason: "no_plan" };
  try { assertTemplateRecovery(deps, planId); return { recoverPlanId: planId, recoverUnavailableReason: null }; }
  catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    const reason = code === "MEMORY_OPERATION_BUSY" ? "busy" : code === "MEMORY_TEMPLATE_LEASE_LOST" ? "active"
      : code === "MEMORY_TEMPLATE_ALREADY_BOUND" ? "already_bound" : code === "MEMORY_TEMPLATE_QUARANTINED" ? "quarantined"
        : code === "MEMORY_TEMPLATE_CONFLICT" ? "cancelled" : code === "MEMORY_TEMPLATE_IDENTITY_CHANGED" ? "stale" : "unavailable";
    return { recoverPlanId: null, recoverUnavailableReason: reason };
  }
}
function stale(): never { throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED"); }
