/**
 * INPUT:  one original plan/Bank/child, current connection/epoch identity and the owning service stop signal
 * OUTPUT: a bounded explicit Native result observation with its read time, or stale/unavailable evidence
 * POS:    read-only operator path — no persistence, executor acquisition, renewal, refresh admission or automatic polling
 */
import { z } from "zod";
import { HindsightTemplateRefreshResultSchema, MemoryTemplateDerivedParamsSchema, MemoryTemplateDerivedObservationSchema,
  type MemoryTemplateDerivedParams, type MemoryTemplateDerivedObservation } from "@taki/shared";
import { readApplicationCheckpoint } from "../../../db/hindsight-application-replica-checkpoint.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../db/hindsight-connection-repo.ts";
import { readCurrentMemoryAuthorityIdentity } from "../../legacy-migration/legacy-activation-repo.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { requireHindsightTemplateCapability } from "../hindsight-template-capability.ts";
import { HindsightTemplateRefusal } from "../hindsight-template-client.ts";
import { templateErrorCode } from "./template-errors.ts";
import { readTemplateHold, readTemplatePlan } from "./template-execution-reads.ts";
import { templateEqual } from "./template-integrity.ts";
import { readTemplateBankReceipt } from "./template-native-evidence-store.ts";
import type { TemplatePlan, TemplatePlanBank } from "./template-plan-schema.ts";
import type { TemplatePreviewDependencies } from "./template-preview-service.ts";
import { boundedTemplateWork } from "./template-rollout.ts";

export const TEMPLATE_DERIVED_TIMEOUT_MS = 30_000;

export async function observeTemplateDerived(deps: TemplatePreviewDependencies, raw: MemoryTemplateDerivedParams,
  stopSignal?: AbortSignal): Promise<MemoryTemplateDerivedObservation> {
  const input = MemoryTemplateDerivedParamsSchema.parse(raw);
  if (stopSignal?.aborted) return { ...input, state: "unavailable", reason: "request_failed", observedAt: null };
  const plan = readTemplatePlan(deps.db, input.planId);
  const bank = plan.banks.find((entry) => entry.identity.target.bank_id === input.bankId);
  if (!bank || !bank.preview.request.refresh.some((child) => child.child_id === input.childId)) throw new Error("MEMORY_TEMPLATE_CONFLICT");
  const receipt = readTemplateBankReceipt(deps.db, { planId: plan.planId, bank });
  if (!receipt) return { ...input, state: "unavailable", reason: "not_observed", observedAt: null };
  const child = receipt.children.find((entry) => entry.child_id === input.childId);
  if (!child) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
  try {
    const before = captureReadGuard(deps, { plan, bank });
    const client = deps.client(before.live.projection);
    if (!client.templateRefreshResult) throw new Error("MEMORY_TEMPLATE_UNSUPPORTED");
    const timeoutMs = Math.min(TEMPLATE_DERIVED_TIMEOUT_MS, before.live.projection.requestTimeoutMs);
    const deadline = AbortSignal.timeout(timeoutMs);
    const context = { timeoutMs, signal: stopSignal ? AbortSignal.any([stopSignal, deadline]) : deadline };
    const current = () => {
      context.signal.throwIfAborted();
      if (!templateEqual(captureReadGuard(deps, { plan, bank }), before)) changed();
    };
    const manifest = await boundedTemplateWork(context.signal, client.compatibility(context));
    current(); requireHindsightTemplateCapability(manifest);
    if (manifest.provider.lineage !== receipt.target.provider_lineage) changed();
    const result = HindsightTemplateRefreshResultSchema.parse(await boundedTemplateWork(context.signal, client.templateRefreshResult({
      request: { contract_version: "1.0.0", target: receipt.target, request_id: receipt.request_id,
        request_hash: receipt.request_hash, child_id: child.child_id }, context,
    })));
    current();
    if (!templateEqual(result.target, receipt.target) || result.request_id !== receipt.request_id || result.child_id !== child.child_id
      || result.model_id !== child.model_id || result.definition_hash !== child.definition_hash) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
    return MemoryTemplateDerivedObservationSchema.parse({ ...input, state: "observed", observedAt: deps.now(), result });
  } catch (cause) { return unavailable(input, cause); }
}

/** Rechecks only this Bank's identity. Ordinary replica cursor progress does not invalidate an exact child-result read. */
function captureReadGuard(deps: TemplatePreviewDependencies, input: { plan: TemplatePlan; bank: TemplatePlanBank }) {
  const { plan, bank } = input;
  if (readTemplateHold(deps.db, plan.planId)?.state === "quarantined") throw new Error("MEMORY_TEMPLATE_QUARANTINED");
  const selection = readCurrentMemoryAuthorityIdentity(deps.db);
  if (selection.mode !== "hindsight" || selection.epochId !== plan.guard.epochId || selection.providerLineageId !== bank.namespace.provider_lineage) changed();
  const setup = createHindsightBankSetupRepo(deps.db).get(bank.identity.canonicalIdentity);
  if (!setup || setup.externalBankId !== bank.identity.target.bank_id || setup.scope !== bank.identity.scope) changed();
  const checkpoint = readApplicationCheckpoint(deps.db, setup.externalBankId);
  if (checkpoint ? checkpoint.bankDeleted || checkpoint.authorityEpochId !== plan.guard.epochId || !templateEqual(checkpoint.namespace, bank.namespace)
    : plan.guard.provisionBankId !== setup.externalBankId) changed();
  const live = readHindsightLiveProjection(deps);
  if (live.state !== "ready") throw new Error("HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE");
  const connection = createHindsightConnectionRepo(deps.db).read();
  if (connection.configFingerprint !== live.fingerprint) changed();
  const configRevision = z.int().min(0).parse(deps.db.prepare("SELECT revision FROM hindsight_template_config_clock WHERE singleton=1").get()?.revision);
  return { live, configRevision, connectionRevision: connection.revision, setup,
    epochId: selection.epochId, namespace: checkpoint?.namespace ?? bank.namespace };
}

function unavailable(input: MemoryTemplateDerivedParams, cause: unknown): MemoryTemplateDerivedObservation {
  const observedAt = null;
  if (cause instanceof HindsightTemplateRefusal && ["generation_mismatch", "bank_not_found", "request_conflict"].includes(cause.reason)) {
    return { ...input, state: "stale", reason: "identity_changed", observedAt };
  }
  const code = templateErrorCode(cause, "MEMORY_TEMPLATE_NATIVE_REFUSED");
  if (code === "MEMORY_TEMPLATE_IDENTITY_CHANGED") return { ...input, state: "stale", reason: "identity_changed", observedAt };
  if (code === "MEMORY_TEMPLATE_QUARANTINED") return { ...input, state: "stale", reason: "quarantined", observedAt };
  const reason = cause instanceof Error && cause.message === "HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE" ? "connection_unavailable"
    : code === "MEMORY_TEMPLATE_UNSUPPORTED" ? "unsupported"
    : code === "MEMORY_TEMPLATE_EVIDENCE_INVALID" || cause instanceof z.ZodError ? "invalid_evidence" : "request_failed";
  return { ...input, state: "unavailable", reason, observedAt };
}
function changed(): never { throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED"); }
