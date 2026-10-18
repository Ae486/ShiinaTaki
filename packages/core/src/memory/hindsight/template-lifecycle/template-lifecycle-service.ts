/**
 * INPUT:  Core-held previews, original operation admissions and existing runtime control seams
 * OUTPUT: template admission/observation/cancel, preview/status/child reads and explicit original-plan recovery
 * POS:    producer behind memory.operations — no second generic operation journal or autonomous recovery loop
 */
import { MemoryTemplateRequestSchema, type MemoryBankProducerRef, type MemoryOperation, type MemoryTemplateDerivedParams,
  type MemoryTemplateProducerRef, type MemoryTemplateRequest } from "@taki/shared";
import { MemoryOperationRefusal, type MemoryOperationSettlement } from "../../operations/memory-operation-contract.ts";
import { activeTemplateHold, findTemplateAdmission, readTemplateHold, readTemplatePlan, readTemplatePublication, templateHasDispatch } from "./template-execution-reads.ts";
import { createTemplateExecutionService, type TemplateExecutionDependencies } from "./template-execution-service.ts";
import { readTemplateExecutor } from "./template-executor-store.ts";
import { captureTemplatePlanGuard } from "./template-plan-guard.ts";
import { cancelUndispatchedTemplatePlan, persistTemplateAdmission } from "./template-plan-store.ts";
import { createTemplatePreviewService } from "./template-preview-service.ts";
import { readTemplateStatus } from "./template-status.ts";
import { templateEqual } from "./template-integrity.ts";
import { prepareProvisionTemplate, type TemplateProvisionInput } from "./template-provision.ts";
import { assertTemplateRecovery } from "./template-recovery-admission.ts";
import { observeTemplateDerived } from "./template-derived-observation.ts";

export function createHindsightTemplateLifecycleService(deps: TemplateExecutionDependencies) {
  const executor = createTemplateExecutionService(deps); const preview = createTemplatePreviewService(deps, executor.stopSignal);
  return {
    ...preview, ...executor,
    provisionBound: (ref: MemoryBankProducerRef): boolean => {
      const planId = ref.templateProvision?.planId;
      if (!planId) return false;
      const publication = readTemplatePublication(deps.db, planId);
      return publication !== null && publication.epochId === ref.admittedEpochId
        && readTemplateHold(deps.db, planId)?.state === "published"
        && deps.runtime.boundSelectionIdentity() === publication.selectionIdentity;
    },
    provision: async (input: TemplateProvisionInput) => {
      const producer = await prepareProvisionTemplate(deps, input);
      await executor.execute({ operationId: input.operationId, producer, signal: input.signal, checkpoint: () => undefined });
      const publication = readTemplatePublication(deps.db, producer.planId);
      if (!publication) throw new Error(readTemplateExecutor(deps.db, producer.planId).errorCode ?? "MEMORY_TEMPLATE_OUTCOME_UNKNOWN");
      if (deps.runtime.boundSelectionIdentity() !== publication.selectionIdentity) throw new Error("MEMORY_TEMPLATE_BINDING_UNAVAILABLE");
    },
    status: (input: { planId?: string; bankId?: string } = {}) => readTemplateStatus({ ...deps,
      boundSelectionIdentity: deps.runtime.boundSelectionIdentity }, input),
    derived: (input: MemoryTemplateDerivedParams) => observeTemplateDerived(deps, input, executor.stopSignal),
    existing: (request: MemoryTemplateRequest) => findTemplateAdmission(deps.db, request),
    bankIds: (request: MemoryTemplateRequest) => (request.kind === "template.apply"
      ? preview.resolve(request.previewId, request.previewHash) : readTemplatePlan(deps.db, request.planId)).banks.map((bank) => bank.identity.target.bank_id),
    admit: (raw: MemoryTemplateRequest): MemoryTemplateProducerRef => {
      const request = MemoryTemplateRequestSchema.parse(raw);
      if (executor.stopped()) throw new MemoryOperationRefusal("MEMORY_TEMPLATE_LEASE_LOST");
      if (request.kind === "template.apply") {
        const plan = preview.resolve(request.previewId, request.previewHash);
        if (!templateEqual(captureTemplatePlanGuard(deps, plan.guard.manifestHash), plan.guard)) throw new MemoryOperationRefusal("MEMORY_TEMPLATE_IDENTITY_CHANGED");
        if (activeTemplateHold(deps.db, plan.guard.epochId)) throw new MemoryOperationRefusal("MEMORY_TEMPLATE_HOLD");
        return { kind: "template", planId: plan.planId, requestId: request.requestId, phase: "admitted" };
      }
      assertTemplateRecovery({ ...deps, boundSelectionIdentity: deps.runtime.boundSelectionIdentity }, request.planId);
      return { kind: "template", planId: request.planId, requestId: request.requestId, phase: "admitted" };
    },
    persistAdmission: (operation: MemoryOperation) => {
      const request = MemoryTemplateRequestSchema.parse(operation.request);
      persistTemplateAdmission(deps.db, { operation, request, bootId: deps.bootId,
        preview: request.kind === "template.apply" ? preview.resolve(request.previewId, request.previewHash) : null });
    },
    observe: (operation: MemoryOperation, boot = false) => observe(deps, operation, boot),
    cancel: (operation: MemoryOperation) => {
      if (operation.state !== "admitted" || operation.producer?.kind !== "template") throw new MemoryOperationRefusal("MEMORY_OPERATION_RUNNING");
      if (operation.kind === "template.apply") cancelUndispatchedTemplatePlan(deps.db, operation.producer.planId);
    },
  };
}
export type HindsightTemplateLifecycleService = ReturnType<typeof createHindsightTemplateLifecycleService>;

function observe(deps: TemplateExecutionDependencies, operation: MemoryOperation, boot: boolean): MemoryOperationSettlement | null {
  if (operation.producer?.kind !== "template") return null;
  const plan = readTemplatePlan(deps.db, operation.producer.planId); const hold = readTemplateHold(deps.db, plan.planId);
  if (!hold) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  const executor = readTemplateExecutor(deps.db, plan.planId); const publication = readTemplatePublication(deps.db, plan.planId);
  const status = readTemplateStatus({ ...deps, boundSelectionIdentity: deps.runtime.boundSelectionIdentity }, { planId: plan.planId });
  const resultBase = { kind: "template" as const, planId: plan.planId, originalOperationId: plan.originalOperationId,
    publicationId: publication?.publicationId ?? null,
    appliedBanks: status.plan!.banks.filter((bank) => bank.receiptHash !== null).length, totalBanks: plan.banks.length };
  if (hold.state === "quarantined") return { state: "outcome_unknown", reason: "commitment_unknown", errorCode: "MEMORY_TEMPLATE_QUARANTINED",
    result: { ...resultBase, outcome: "quarantined" } };
  // The generic owner defers producer work until after its ACK. Neither status nor cancel may
  // mistake that intentional admitted window for an expired executor, including recovery admissions.
  if (!boot && operation.state === "admitted" && operation.producer.phase === "admitted") return null;
  if (publication && deps.runtime.boundSelectionIdentity() === publication.selectionIdentity) return { state: "completed", reason: null, errorCode: null,
    result: { ...resultBase, outcome: "bound" } };
  if (!boot && executor.bootId === deps.bootId && executor.deadlineMs > Date.parse(deps.now())) {
    return executor.operationId === operation.operationId ? null
      : { state: "failed", reason: "producer_refused", errorCode: "MEMORY_TEMPLATE_LEASE_LOST", result: null };
  }
  if (hold.state === "cancelled") return { state: "cancelled", reason: "cancelled_before_claim", errorCode: null,
    result: { ...resultBase, outcome: "cancelled" } };
  if (publication) return { state: "failed", reason: "runtime_unavailable", errorCode: "MEMORY_TEMPLATE_BINDING_UNAVAILABLE",
    result: { ...resultBase, outcome: "binding_unavailable" } };
  const possible = templateHasDispatch(deps.db, plan.planId);
  return { state: possible || boot ? "outcome_unknown" : "failed", reason: possible ? "commitment_unknown" : "producer_incomplete",
    errorCode: executor.errorCode ?? "MEMORY_TEMPLATE_OUTCOME_UNKNOWN",
    result: { ...resultBase, outcome: resultBase.appliedBanks ? "partial" : "outcome_unknown" } };
}
