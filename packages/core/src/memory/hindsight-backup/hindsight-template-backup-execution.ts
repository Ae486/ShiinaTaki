/**
 * INPUT:  complete Core template histories, original B2 plans, dispatches, receipts and publication/hold rows
 * OUTPUT: verified receipt/publication references and a clear-hold commitment over every relevant original plan
 * POS:    copied-Core execution evidence; generic terminal operation status cannot erase an unpublished effect
 */
import type { HindsightTemplateReceipt } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { readTemplateEmergencyEffects } from "../../db/hindsight-template-emergency-evidence.ts";
import { emergencyRowHash } from "../../db/memory-transition-row-hash.ts";
import { hasTemplateExecutionStorage, readTemplatePlan, readTemplateHold, readTemplatePublication } from "../hindsight/template-lifecycle/template-execution-reads.ts";
import { readTemplateBankReceipt } from "../hindsight/template-lifecycle/template-native-evidence-store.ts";
import { TemplateDispatchSchema, TemplateObservationSchema, type TemplatePlan, type TemplatePlanBank,
  type TemplatePublication } from "../hindsight/template-lifecycle/template-plan-schema.ts";
import { readTemplateDocument, templateIdentityKey } from "../hindsight/template-lifecycle/template-store-documents.ts";
import { templateEqual } from "../hindsight/template-lifecycle/template-integrity.ts";
import { verifyTemplateApplication } from "../hindsight/template-lifecycle/template-receipt.ts";
import { readHindsightTemplateBackupHistory, type HindsightTemplateBackupHistory,
  type HindsightTemplateBackupHistoryReader } from "./hindsight-template-backup-history.ts";
import { hindsightBackupHash } from "./hindsight-template-backup-integrity.ts";
import { assertHindsightTemplatePublicationIdentity } from "./hindsight-template-backup-publication.ts";

export interface HindsightTemplateBackupPublication {
  plan: TemplatePlan; bank: TemplatePlanBank; publication: TemplatePublication; receipt: HindsightTemplateReceipt;
}
export function readHindsightTemplateBackupExecution(db: Database, input: {
  epochId: string; histories: HindsightTemplateBackupHistory[];
}, readHistory: HindsightTemplateBackupHistoryReader = (identity) => readHindsightTemplateBackupHistory(db, identity)) {
  const targets = new Set(input.histories.map((history) => templateIdentityKey(history.identity)));
  const publications = new Map<string, HindsightTemplateBackupPublication>();
  const receipts: HindsightTemplateReceipt[] = [];
  const refreshKeys = new Set<string>();
  const records = [];
  if (hasTemplateExecutionStorage(db)) {
    if (readTemplateEmergencyEffects(db, input.epochId).length) unpublished();
    const rows = db.prepare("SELECT plan_id FROM hindsight_template_plans ORDER BY plan_id").all();
    for (const row of rows) {
      const plan = readTemplatePlan(db, String(row.plan_id));
      if (!plan.banks.some((bank) => targets.has(templateIdentityKey(bank.identity)))) continue;
      const record = readExecution(db, { plan, readHistory });
      records.push(record);
      for (const bank of plan.banks) {
        if (!targets.has(templateIdentityKey(bank.identity))) continue;
        const receipt = record.receipts.find((value) => value.request_id === bank.preview.request.request_id);
        if (receipt) receipts.push(receipt);
        if (receipt && record.publication) publications.set(receipt.request_id, { plan, bank, receipt, publication: record.publication });
      }
      for (const observation of record.observations) {
        if (!targets.has(observation.bankKey)) continue;
        for (const child of observation.children) {
          if (child.state === "superseded" || child.result_revision !== null && child.result_payload_hash !== null
            && ["completed", "failed"].includes(child.state)) refreshKeys.add("template-refresh-result:" + child.child_id);
        }
      }
    }
  }
  const value = { authorityEpochId: input.epochId, plans: records.map((record) => record.plan),
    holds: records.map((record) => record.hold), dispatches: records.flatMap((record) => record.dispatches),
    publications: records.flatMap((record) => record.publication ? [record.publication] : []),
    observations: records.flatMap((record) => record.observations), quarantines: records.flatMap((record) => record.quarantines) };
  return { receipts, publications, refreshKeys: [...refreshKeys].sort(), hold: { state: "clear" as const, digest: hindsightBackupHash("hold", value) } };
}

function readExecution(db: Database, input: { plan: TemplatePlan; readHistory: HindsightTemplateBackupHistoryReader }) {
  const { plan } = input;
  const hold = readTemplateHold(db, plan.planId);
  if (!hold || hold.epochId !== plan.guard.epochId || hold.originalOperationId !== plan.originalOperationId) invalid();
  if (hold.state === "active" || hold.state === "quarantined") unpublished();
  const dispatches = readDispatches(db, plan);
  const receipts = plan.banks.flatMap((bank) => {
    const value = readTemplateBankReceipt(db, { planId: plan.planId, bank }); return value ? [value] : [];
  });
  // Extra rows cannot hide behind an original-plan Bank filter.
  const receiptCount = db.prepare("SELECT count(*) AS count FROM hindsight_template_bank_receipts WHERE plan_id=:id").get({ id: plan.planId })?.count;
  if (receiptCount !== receipts.length) invalid();
  const observations = readObservations(db, { plan, receipts });
  const publication = readTemplatePublication(db, plan.planId);
  if (hold.state === "cancelled") {
    if (dispatches.length || receipts.length || observations.length || publication) invalid();
  } else {
    if (!publication || hold.publicationId !== publication.publicationId) invalid();
    verifyPublication(db, { ...input, publication, receipts });
  }
  const quarantines = db.prepare("SELECT * FROM memory_transition_emergency_quarantine WHERE operation_id=:id").all({ id: plan.originalOperationId })
    .map((row) => ({ operationId: plan.originalOperationId, rowHash: emergencyRowHash(row) }));
  return { plan, hold, dispatches, receipts, observations, publication, quarantines };
}

function readDispatches(db: Database, plan: TemplatePlan) {
  return db.prepare("SELECT * FROM hindsight_template_dispatches WHERE plan_id=:id ORDER BY dispatch_id").all({ id: plan.planId }).map((row) => {
    const value = readTemplateDocument(row, TemplateDispatchSchema);
    const bank = plan.banks.find((entry) => templateIdentityKey(entry.identity) === value.bankKey);
    if (!bank || value.planId !== plan.planId || row.dispatch_id !== value.dispatchId || row.bank_key !== value.bankKey
      || row.request_id !== value.requestId || row.generation !== value.generation || row.executor_token !== value.executorToken
      || value.requestId !== bank.preview.request.request_id || value.requestHash !== bank.preview.request.request_hash) invalid();
    return value;
  });
}

function readObservations(db: Database, input: { plan: TemplatePlan; receipts: HindsightTemplateReceipt[] }) {
  return db.prepare("SELECT * FROM hindsight_template_observations WHERE plan_id=:id ORDER BY observation_id").all({ id: input.plan.planId }).map((row) => {
    const value = readTemplateDocument(row, TemplateObservationSchema);
    const bank = input.plan.banks.find((entry) => templateIdentityKey(entry.identity) === value.bankKey);
    const receipt = input.receipts.find((entry) => entry.request_id === value.receipt.request_id);
    if (!bank || value.planId !== input.plan.planId || row.observation_id !== value.observationId || row.bank_key !== value.bankKey
      || !receipt || !templateEqual(receipt, value.receipt)) invalid();
    verifyTemplateApplication({ preview: bank.preview, receipt, snapshot: value.snapshot });
    for (const child of value.children) {
      const original = receipt.children.find((entry) => entry.child_id === child.child_id);
      if (!original || child.request_id !== receipt.request_id || !templateEqual(child.target, receipt.target)
        || child.model_id !== original.model_id || child.definition_hash !== original.definition_hash
        || (child.result_revision === null) !== (child.result_payload_hash === null)
        || child.state === "completed" && child.result_revision === null) invalid();
    }
    return value;
  });
}

function verifyPublication(db: Database, input: { plan: TemplatePlan; publication: TemplatePublication;
  receipts: HindsightTemplateReceipt[]; readHistory: HindsightTemplateBackupHistoryReader }): void {
  const { plan, publication, readHistory } = input;
  const defaultsRevision = plan.guard.defaultsRevision + (plan.params.target.kind === "defaults" ? 1 : 0);
  if (publication.planHash !== plan.planHash || publication.epochId !== plan.guard.epochId
    || publication.defaultsRevision !== defaultsRevision || publication.connectionRevision !== plan.guard.connectionRevision + 1
    || publication.selections.length !== plan.banks.length || input.receipts.length !== plan.banks.length) invalid();
  const seen = new Set<string>();
  for (const bank of plan.banks) {
    const key = templateIdentityKey(bank.identity);
    const reference = publication.selections.find((entry) => templateIdentityKey(entry.identity) === key);
    if (!reference || seen.has(key) || reference.revision !== bank.expectedSelectionRevision + 1) invalid();
    seen.add(key);
    const history = readHistory(bank.identity);
    const selection = history.selections[reference.revision - 1];
    const receipt = input.receipts.find((entry) => entry.request_id === bank.preview.request.request_id);
    if (!selection || !receipt || !templateEqual(selection.request, bank.preview.request)
      || !templateEqual(selection.receipt, receipt) || reference.receiptHash !== receipt.receipt_hash
      || selection.committedAt !== publication.committedAt) invalid();
  }
  assertHindsightTemplatePublicationIdentity(db, { plan, publication }, readHistory);
}
function invalid(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN"); }
function unpublished(): never { throw new Error("HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED"); }
