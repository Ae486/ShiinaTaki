/**
 * INPUT:  a claimed bank.provision operation and the independently published Character template default
 * OUTPUT: durable empty-Bank reservation, real incarnation snapshot and one original recoverable template plan
 * POS:    new-Bank installation — legacy v1 stays on its existing producer; no automatic enrollment of occupied Banks
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type MemoryBankProducerRef, type MemoryTemplatePreviewParams, type MemoryTemplateProducerRef } from "@taki/shared";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createMemoryOperationRepo } from "../../../db/memory-operation-repo.ts";
import { operationIsQuarantined } from "../../../db/memory-transition-emergency-quarantine.ts";
import { readMemoryAuthoritySelection } from "../../legacy-migration/legacy-activation-repo.ts";
import { assertHindsightBankUnoccupied } from "../../hindsight-lifecycle/hindsight-bank-occupancy.ts";
import { hindsightBankBindings } from "../hindsight-bank-identity.ts";
import { readHindsightLiveProjection } from "../hindsight-runtime-connection.ts";
import { requireHindsightTemplateCapability } from "../hindsight-template-capability.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import type { TemplateExecutionDependencies } from "./template-execution-service.ts";
import { activeTemplateHold, templatePlanHash } from "./template-execution-reads.ts";
import { signTemplateRequest, templateEqual, templateHash } from "./template-integrity.ts";
import { buildTemplatePlanBank } from "./template-plan-builder.ts";
import { captureTemplatePlanGuard } from "./template-plan-guard.ts";
import { TemplatePreviewPlanSchema } from "./template-plan-schema.ts";
import { persistTemplateAdmission } from "./template-plan-store.ts";
import { TEMPLATE_PREVIEW_TTL_MS } from "./template-preview-service.ts";
import { readTemplateDocument, templateDocument } from "./template-store-documents.ts";

const Reservation = z.strictObject({ reservationId: z.uuid(), epochId: z.string(), bankId: z.string(), canonicalIdentity: z.string(),
  operationId: z.uuid(), configFingerprint: z.string().length(64), createdAt: z.iso.datetime({ offset: true }) });
export interface TemplateProvisionInput { operationId: string; ref: MemoryBankProducerRef; signal: AbortSignal }

export async function prepareProvisionTemplate(deps: TemplateExecutionDependencies, input: TemplateProvisionInput): Promise<MemoryTemplateProducerRef> {
  const provisioning = input.ref.templateProvision;
  if (!provisioning) throw new Error("MEMORY_TEMPLATE_CONFLICT");
  const live = assertProvisionCurrent(deps, input); const client = deps.client(live.projection);
  const request = () => { assertProvisionCurrent(deps, input); return { timeoutMs: live.projection.requestTimeoutMs, signal: input.signal }; };
  const manifest = await client.compatibility(request());
  requireHindsightTemplateCapability(manifest); request();
  // A reservation records a possible create from this Core. It is not Native ownership,
  // so every resumed attempt must probe again before and after the idempotent empty PUT.
  await assertHindsightBankUnoccupied({ client, bankId: input.ref.nativeBankId, context: request() });
  request();
  await reserveBank(deps, { ...input, client, request });
  const created = await client.createOrUpdateBank(input.ref.nativeBankId, request());
  if (created.bankId !== input.ref.nativeBankId) conflict();
  request();
  await assertHindsightBankUnoccupied({ client, bankId: input.ref.nativeBankId, context: request() });
  request();
  if (!client.createLogicalSnapshot) throw new Error("MEMORY_TEMPLATE_UNSUPPORTED");
  const native = await client.createLogicalSnapshot({ bankId: input.ref.nativeBankId, pageSize: 1, ttlSeconds: 600, context: request() });
  request();
  const binding = hindsightBankBindings(input.ref.characterId)[1];
  const namespace = { application_id: "taki" as const, provider_lineage: native.manifest.providerLineage,
    bank_generation: native.manifest.bankGeneration };
  if (native.manifest.bankId !== binding.externalBankId || namespace.provider_lineage !== manifest.provider.lineage) conflict();
  const identity = { scope: "character" as const, canonicalIdentity: binding.canonicalIdentity,
    target: { provider_lineage: namespace.provider_lineage, bank_generation: namespace.bank_generation, bank_id: binding.externalBankId } };
  const guard = captureTemplatePlanGuard(deps, templateHash("definition", manifest), { identity, namespace });
  const bank = guard.banks.find((entry) => entry.identity.target.bank_id === binding.externalBankId);
  if (!bank || guard.defaultsRevision !== provisioning.defaultsRevision) conflict();
  const params: MemoryTemplatePreviewParams = { target: { kind: "bank", bankId: binding.externalBankId,
    templateRevision: input.ref.templateRevision, userChoices: null }, enrollment: "fresh", directives: [], refresh: [] };
  const planned = await buildTemplatePlanBank({ db: deps.db, client, request, bank, params });
  // Native rechecks its original creation, ever-used flag and full empty definition state
  // inside Apply's locked transaction. A later write can invalidate this proof even when
  // both occupancy probes were empty. Never remove this claim to retry a refusal.
  planned.preview.request = signTemplateRequest({ ...planned.preview.request, initialization: {
    template_revision: planned.preview.templateRevision, template_hash: planned.preview.effectiveDefinitionHash,
  } });
  request();
  const createdAt = deps.now();
  const preview = TemplatePreviewPlanSchema.parse({ planId: provisioning.planId, bootId: deps.bootId, params, guard, banks: [planned],
    createdAt, expiresAt: new Date(Date.parse(createdAt) + TEMPLATE_PREVIEW_TTL_MS).toISOString() });
  const operation = createMemoryOperationRepo(deps.db).get(input.operationId);
  if (!operation) conflict();
  const requestId = randomUUID();
  deps.db.transaction(() => {
    request();
    if (!templateEqual(captureTemplatePlanGuard(deps, guard.manifestHash, { identity, namespace }), guard)) conflict();
    persistTemplateAdmission(deps.db, { operation, request: { kind: "template.apply", requestId,
      previewId: preview.planId, previewHash: templatePlanHash(preview) }, preview, bootId: deps.bootId });
  });
  return { kind: "template", planId: preview.planId, requestId, phase: "admitted" };
}

function assertProvisionCurrent(deps: TemplateExecutionDependencies, input: TemplateProvisionInput) {
  input.signal.throwIfAborted();
  const selected = readMemoryAuthoritySelection(deps.db);
  const live = readHindsightLiveProjection(deps);
  const operation = createMemoryOperationRepo(deps.db).get(input.operationId);
  if (selected.mode !== "hindsight" || selected.epochId !== input.ref.admittedEpochId || !selected.providerLineageId
    || live.state !== "ready" || live.fingerprint !== input.ref.configFingerprint || !operation || operation.state !== "running"
    || operation.producer?.kind !== "bank" || operation.producer.templateProvision?.planId !== input.ref.templateProvision?.planId
    || operationIsQuarantined(deps.db, input.operationId)) conflict();
  const defaults = readTemplateDefaults(deps.db, selected.providerLineageId);
  if (!defaults || defaults.revision !== input.ref.templateProvision?.defaultsRevision
    || defaults.characterTemplateRevision !== input.ref.templateRevision) conflict();
  if (activeTemplateHold(deps.db, input.ref.admittedEpochId)) throw new Error("MEMORY_TEMPLATE_HOLD");
  return live;
}

async function reserveBank(deps: TemplateExecutionDependencies, input: TemplateProvisionInput & {
  client: ReturnType<TemplateExecutionDependencies["client"]>; request(): { timeoutMs: number; signal: AbortSignal };
}): Promise<void> {
  const ref = input.ref; const binding = hindsightBankBindings(ref.characterId)[1];
  const row = deps.db.prepare("SELECT * FROM hindsight_template_bank_reservations WHERE epoch_id=:epoch AND bank_id=:bank")
    .get({ epoch: ref.admittedEpochId, bank: ref.nativeBankId });
  const setup = createHindsightBankSetupRepo(deps.db);
  if (row) {
    const reservation = readTemplateDocument(row, Reservation);
    if (reservation.epochId !== ref.admittedEpochId || reservation.bankId !== ref.nativeBankId
      || reservation.canonicalIdentity !== binding.canonicalIdentity || reservation.configFingerprint !== ref.configFingerprint
      || setup.get(binding.canonicalIdentity)?.status !== "pending") conflict();
    return;
  }
  if (setup.get(binding.canonicalIdentity)) conflict();
  deps.db.transaction(() => {
    input.request();
    const reservation = Reservation.parse({ reservationId: randomUUID(), epochId: ref.admittedEpochId, bankId: ref.nativeBankId,
      canonicalIdentity: binding.canonicalIdentity, operationId: input.operationId, configFingerprint: ref.configFingerprint, createdAt: deps.now() });
    deps.db.prepare("INSERT INTO hindsight_template_bank_reservations VALUES(:id,:epoch,:bank,:operation,:hash,:json)").run({
      id: reservation.reservationId, epoch: reservation.epochId, bank: reservation.bankId, operation: reservation.operationId,
      ...templateDocument(reservation) });
    setup.upsert({ ...binding, templateRevision: ref.templateRevision, templateDigest: templateHash("definition", reservation),
      status: "pending", lastVerifiedAt: null, lastError: null, operationIds: [] });
  });
}
function conflict(): never { throw new Error("MEMORY_TEMPLATE_IDENTITY_CHANGED"); }
