/**
 * INPUT:  persisted template history/execution evidence and the current bound runtime identity
 * OUTPUT: bounded read-only rollout and explicit per-Bank editing state
 * POS:    operator projection — Native effective values never reconstruct user intent or trigger recovery
 */
import { MemoryTemplateStatusSchema, type MemoryTemplateStatus } from "@taki/shared";
import { createCanonicalMemoryAuthorityRepo } from "../../../db/canonical-memory-authority-repo.ts";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createHindsightRuntimeAdmissionRepo } from "../../../db/hindsight-runtime-admission-repo.ts";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { requireHindsightTemplateCapability } from "../hindsight-template-capability.ts";
import { TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { activeTemplateHold, readTemplateHold, readTemplatePlan, readTemplatePublication, templateHasDispatch } from "./template-execution-reads.ts";
import { readTemplateExecutor } from "./template-executor-store.ts";
import { readTemplateBankReceipt, latestTemplateObservation } from "./template-native-evidence-store.ts";
import { readTemplateEnrollment, readTemplateUser } from "./template-overlay-history.ts";
import { TemplateBankIdentitySchema } from "./template-overlay-schema.ts";
import { readRuntimeTemplateSelection } from "./template-runtime-selection.ts";
import { templateIdentityKey } from "./template-store-documents.ts";
import { templateProjectionDigest } from "./template-projection.ts";
import type { TemplateGuardDependencies } from "./template-plan-guard.ts";
import { templateRecoveryAction } from "./template-recovery-admission.ts";

export function readTemplateStatus(deps: TemplateGuardDependencies & { bootId: string; now(): string; boundSelectionIdentity(): string | null },
  input: { planId?: string; bankId?: string }): MemoryTemplateStatus {
  const selection = readMemoryAuthoritySelection(deps.db);
  const epoch = selection.mode === "hindsight" && selection.epochId ? createCanonicalMemoryAuthorityRepo(deps.db).authorityEpoch(selection.epochId) : null;
  const defaults = epoch ? readTemplateDefaults(deps.db, epoch.providerLineageId) : null;
  const hold = epoch ? activeTemplateHold(deps.db, epoch.epochId) : null;
  const latest = input.planId ?? hold?.planId ?? (epoch ? deps.db.prepare(
    "SELECT plan_id FROM hindsight_template_plans WHERE epoch_id=:epoch ORDER BY rowid DESC LIMIT 1").get({ epoch: epoch.epochId })?.plan_id : null);
  return MemoryTemplateStatusSchema.parse({ supported: supported(deps, epoch?.epochId ?? null),
    previewAvailable: epoch !== null && hold === null && readHindsightLiveProjection(deps).state === "ready", holdPlanId: hold?.planId ?? null,
    ...templateRecoveryAction(deps, latest ? String(latest) : null),
    boundSelectionIdentity: deps.boundSelectionIdentity(), defaults: defaults ? { revision: defaults.revision,
      globalTemplateRevision: defaults.globalTemplateRevision, characterTemplateRevision: defaults.characterTemplateRevision } : null,
    catalogs: ["global", "character"].map((scope) => ({ revision: TAKI_MANAGED_TEMPLATE_REVISION, scope })),
    bank: input.bankId ? bankStatus(deps, { bankId: input.bankId, epochId: epoch?.epochId ?? null, holdPlanId: hold?.planId ?? null }) : null,
    plan: latest ? planStatus(deps, String(latest)) : null });
}
function planStatus(deps: TemplateGuardDependencies, planId: string): NonNullable<MemoryTemplateStatus["plan"]> {
  const plan = readTemplatePlan(deps.db, planId); const executor = readTemplateExecutor(deps.db, planId);
  const hold = readTemplateHold(deps.db, planId); const publication = readTemplatePublication(deps.db, planId);
  if (!hold) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  return { planId, originalOperationId: plan.originalOperationId, phase: executor.phase, hold: hold.state,
    executorRevision: executor.revision, errorCode: executor.errorCode, publicationId: publication?.publicationId ?? null,
    banks: plan.banks.map((bank) => {
      const key = templateIdentityKey(bank.identity); const receipt = readTemplateBankReceipt(deps.db, { planId, bank });
      const observation = latestTemplateObservation(deps.db, { planId, bankKey: key });
      return { bank: bank.summary, dispatched: templateHasDispatch(deps.db, planId, key), receiptHash: receipt?.receipt_hash ?? null,
        selectionRevision: publication?.selections.find((entry) => templateIdentityKey(entry.identity) === key)?.revision ?? null,
        derived: (receipt?.children ?? []).map((child) => ({ childId: child.child_id, modelId: child.model_id,
          source: "rollout_record" as const, observedAt: observation?.children.some((entry) => entry.child_id === child.child_id) ? observation.verifiedAt : null,
          state: observation?.children.find((entry) => entry.child_id === child.child_id)?.state ?? "unknown" })) };
    }) };
}
function bankStatus(deps: TemplateGuardDependencies, input: { bankId: string; epochId: string | null; holdPlanId: string | null }): MemoryTemplateStatus["bank"] {
  const setup = createHindsightBankSetupRepo(deps.db).list().find((row) => row.externalBankId === input.bankId);
  if (!setup) throw new Error("MEMORY_TEMPLATE_CONFLICT");
  const checkpoint = readApplicationCheckpoint(deps.db, input.bankId);
  const valid = checkpoint && !checkpoint.bankDeleted && checkpoint.authorityEpochId === input.epochId ? checkpoint : null;
  const identity = valid ? TemplateBankIdentitySchema.parse({ scope: setup.scope, canonicalIdentity: setup.canonicalIdentity,
    target: { bank_id: input.bankId, provider_lineage: valid.namespace.provider_lineage, bank_generation: valid.namespace.bank_generation } }) : null;
  const enrollment = identity ? readTemplateEnrollment(deps.db, identity) : null;
  const selected = valid ? readRuntimeTemplateSelection(deps.db, { bankId: input.bankId, namespace: valid.namespace }) : null;
  const pendingPlan = input.holdPlanId ? readTemplatePlan(deps.db, input.holdPlanId) : null;
  const pending = pendingPlan?.banks.find((bank) => bank.identity.target.bank_id === input.bankId);
  return { bankId: input.bankId, canonicalIdentity: setup.canonicalIdentity, scope: setup.scope, target: identity?.target ?? null,
    enrollment: selected ? "managed" : enrollment ? "enrolled" : "untracked",
    latestUser: enrollment && identity ? readTemplateUser(deps.db, identity) : null,
    selected: selected && identity ? { revision: selected.revision, templateRevision: selected.templateRevision,
      enrollmentRevision: selected.enrollmentRevision, effectiveDefinitionHash: templateProjectionDigest(selected.projection),
      receiptHash: selected.receipt.receipt_hash, user: readTemplateUser(deps.db, identity, selected.userRevision)! } : null,
    pending: pending && pendingPlan ? { planId: pendingPlan.planId, templateRevision: pending.preview.templateRevision, userRevision: pending.preview.userRevision } : null };
}
function supported(deps: TemplateGuardDependencies, epochId: string | null): boolean {
  if (!epochId) return false;
  try {
    const live = readHindsightLiveProjection(deps);
    if (live.state !== "ready") return false;
    const admission = createHindsightRuntimeAdmissionRepo(deps.db).read({ authorityEpochId: epochId, configFingerprint: live.fingerprint });
    if (!admission) return false;
    requireHindsightTemplateCapability(admission.manifest);
    return true;
  } catch { return false; }
}
