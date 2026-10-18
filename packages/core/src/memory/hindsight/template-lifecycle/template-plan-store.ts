/**
 * INPUT:  the existing operation admission transaction and one Core-held genuine preview
 * OUTPUT: immutable original plan/request identities, desired histories, initial executor and durable hold
 * POS:    template producer admission — no Native I/O; a lost acknowledgement resolves the same stored request
 */
import type { MemoryOperation, MemoryTemplateRequest } from "@taki/shared";
import type { Database } from "../../../db/sqlite.ts";
import { appendTemplateEnrollment, appendTemplateUser, readTemplateEnrollment, readTemplateUser, storeTemplateCatalogEntry } from "./template-overlay-history.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { previewTemplateOverlay } from "./template-preview.ts";
import { TemplatePlanSchema, type TemplatePlan, type TemplatePlanBank, type TemplatePreviewPlan } from "./template-plan-schema.ts";
import { findTemplateAdmission, readTemplatePlan, readTemplateHold, templateHasDispatch, templatePlanHash } from "./template-execution-reads.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";
import { templateDocument } from "./template-store-documents.ts";
import { templateDefaultCatalogs } from "./template-default-catalogs.ts";

export function persistTemplateAdmission(db: Database, input: {
  operation: MemoryOperation; request: MemoryTemplateRequest; preview: TemplatePreviewPlan | null; bootId: string;
}): TemplatePlan {
  const { operation, request } = input;
  const provisionProducer = operation.kind === "bank.provision" && operation.producer?.kind === "bank" ? operation.producer : null;
  const isProvision = provisionProducer?.templateProvision;
  if (!isProvision && (operation.producer?.kind !== "template" || operation.kind !== request.kind)) invalid();
  const producer = operation.producer;
  const producerPlanId = producer?.kind === "template" ? producer.planId : producer?.kind === "bank" ? producer.templateProvision?.planId : null;
  let plan: TemplatePlan | undefined;
  db.transaction(() => {
    if (findTemplateAdmission(db, request)) conflict();
    if (request.kind === "template.apply") {
      if (!input.preview || input.preview.planId !== producerPlanId
        || templatePlanHash(input.preview) !== request.previewHash) conflict();
      if (isProvision && (input.preview.guard.provisionBankId !== provisionProducer?.nativeBankId
        || input.preview.guard.defaultsRevision !== isProvision.defaultsRevision)) conflict();
      plan = TemplatePlanSchema.parse({ ...input.preview, originalOperationId: operation.operationId,
        originalRequestId: request.requestId, planHash: request.previewHash });
      for (const catalog of templateDefaultCatalogs(db, plan.params.target)) storeTemplateCatalogEntry(db, catalog);
      for (const bank of plan.banks) persistDesired(db, bank);
      const document = templateDocument(plan);
      db.prepare(`INSERT INTO hindsight_template_plans VALUES(:id,:operation,:epoch,:planHash,:hash,:json,:at)`).run({
        id: plan.planId, operation: plan.originalOperationId, epoch: plan.guard.epochId, planHash: plan.planHash,
        ...document, at: operation.createdAt });
      db.prepare("INSERT INTO hindsight_template_executors VALUES(:id,0,0,:operation,:boot,NULL,0,'admitted',NULL,:at)")
        .run({ id: plan.planId, operation: operation.operationId, boot: input.bootId, at: operation.createdAt });
      db.prepare("INSERT INTO hindsight_template_holds VALUES(:id,:epoch,'active',NULL)")
        .run({ id: plan.planId, epoch: plan.guard.epochId });
    } else plan = readTemplatePlan(db, request.planId);
    db.prepare("INSERT INTO hindsight_template_admissions VALUES(:request,:operation,:plan,:hash,:json)").run({
      request: request.requestId, operation: operation.operationId, plan: plan.planId,
      hash: templateHash("definition", request), json: JSON.stringify(request) });
  });
  if (!plan) invalid();
  return plan;
}

/** Reconstruct with B1's exact composer after writes, so an internal stale or altered preview rolls everything back. */
function persistDesired(db: Database, bank: TemplatePlanBank): void {
  const previousEnrollment = readTemplateEnrollment(db, bank.identity);
  const previous = previousEnrollment ? readAppliedTemplateSelection(db, bank.identity) : null;
  if ((previousEnrollment?.revision ?? 0) !== bank.previousEnrollmentRevision
    || (previous?.revision ?? 0) !== bank.expectedSelectionRevision) conflict();
  if (bank.enrollment.revision !== bank.previousEnrollmentRevision) {
    appendTemplateEnrollment(db, { enrollment: bank.enrollment, expectedRevision: bank.previousEnrollmentRevision });
  } else if (!templateEqual(previousEnrollment, bank.enrollment)) conflict();
  const currentUser = readTemplateUser(db, bank.identity);
  if ((currentUser?.revision ?? null) !== bank.previousUserRevision) conflict();
  let userRevision = bank.previousUserRevision;
  for (const user of bank.usersToAppend) {
    appendTemplateUser(db, { identity: bank.identity, user, expectedRevision: userRevision });
    userRevision = user.revision;
  }
  const user = readTemplateUser(db, bank.identity);
  if (!user) invalid();
  if (bank.template) storeTemplateCatalogEntry(db, bank.template);
  const preview = previewTemplateOverlay({ enrollment: bank.enrollment, user, template: bank.template,
    snapshot: bank.preview.request.expected_snapshot, requestId: bank.preview.request.request_id,
    previous, refresh: bank.preview.request.refresh, initialization: bank.preview.request.initialization,
    reviewedDriftSnapshotHash: bank.preview.request.expected_snapshot.snapshot_hash });
  if (!templateEqual(preview, bank.preview)) invalid();
}

export function cancelUndispatchedTemplatePlan(db: Database, planId: string): void {
  db.transaction(() => {
    const hold = readTemplateHold(db, planId);
    if (!hold || hold.state !== "active" || templateHasDispatch(db, planId)
      || db.prepare("SELECT 1 FROM hindsight_template_bank_receipts WHERE plan_id=:id LIMIT 1").get({ id: planId })) conflict();
    if (db.prepare("UPDATE hindsight_template_holds SET state='cancelled' WHERE plan_id=:id AND state='active'").run({ id: planId }).changes !== 1) conflict();
  });
}
function conflict(): never { throw new Error("MEMORY_TEMPLATE_CONFLICT"); }
function invalid(): never { throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID"); }
