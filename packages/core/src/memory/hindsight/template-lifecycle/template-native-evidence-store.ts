/**
 * INPUT:  current template executor ownership and authenticated Native dispatch/result/readback evidence
 * OUTPUT: append-only possible effects, immutable original receipts and exact current definition/child observations
 * POS:    Core template recovery evidence — a receipt records Native commitment, never runtime publication
 */
import { randomUUID } from "node:crypto";
import { HindsightTemplateReceiptSchema, normalizeHindsightTemplateReceipt, type HindsightTemplateReceipt } from "@taki/shared";
import type { Database } from "../../../db/sqlite.ts";
import { assertTemplateExecutor, type TemplateExecutorLease } from "./template-executor-store.ts";
import { TemplateDispatchSchema, TemplateObservationSchema, type TemplateObservation, type TemplatePlanBank } from "./template-plan-schema.ts";
import { readTemplateDocument, templateDocument, templateIdentityKey } from "./template-store-documents.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";
import { verifyTemplateApplication } from "./template-receipt.ts";
import { readTemplatePlan } from "./template-execution-reads.ts";

export function recordTemplateDispatch(db: Database, input: { lease: TemplateExecutorLease; bank: TemplatePlanBank; now: string }): void {
  db.transaction(() => {
    assertTemplateExecutor(db, input);
    assertPlanBank(db, input.lease.planId, input.bank);
    const request = input.bank.preview.request;
    const value = TemplateDispatchSchema.parse({ dispatchId: randomUUID(), planId: input.lease.planId,
      bankKey: templateIdentityKey(input.bank.identity), requestId: request.request_id, requestHash: request.request_hash,
      generation: input.lease.generation, executorToken: input.lease.token, dispatchedAt: input.now });
    db.prepare("INSERT INTO hindsight_template_dispatches VALUES(:id,:plan,:bank,:request,:generation,:token,:hash,:json)")
      .run({ id: value.dispatchId, plan: value.planId, bank: value.bankKey, request: value.requestId,
        generation: value.generation, token: value.executorToken, ...templateDocument(value) });
    assertTemplateExecutor(db, input);
  });
}

export function readTemplateBankReceipt(db: Database, input: { planId: string; bank: TemplatePlanBank }): HindsightTemplateReceipt | null {
  assertPlanBank(db, input.planId, input.bank);
  const row = db.prepare("SELECT * FROM hindsight_template_bank_receipts WHERE plan_id=:plan AND bank_key=:bank")
    .get({ plan: input.planId, bank: templateIdentityKey(input.bank.identity) });
  if (!row) return null;
  const value = verifyOriginalReceipt(input.bank, readTemplateDocument(row, HindsightTemplateReceiptSchema));
  if (row.request_id !== value.request_id || row.receipt_hash !== value.receipt_hash) invalid();
  return value;
}

export function recordTemplateBankReceipt(db: Database, input: {
  lease: TemplateExecutorLease; bank: TemplatePlanBank; receipt: HindsightTemplateReceipt; now: string;
}): void {
  const value = verifyOriginalReceipt(input.bank, input.receipt);
  db.transaction(() => {
    assertTemplateExecutor(db, input);
    assertPlanBank(db, input.lease.planId, input.bank);
    const prior = readTemplateBankReceipt(db, { planId: input.lease.planId, bank: input.bank });
    if (prior) { if (!templateEqual(prior, value)) invalid(); return; }
    db.prepare("INSERT INTO hindsight_template_bank_receipts VALUES(:request,:plan,:bank,:receipt,:hash,:json)")
      .run({ request: value.request_id, plan: input.lease.planId, bank: templateIdentityKey(input.bank.identity),
        receipt: value.receipt_hash, ...templateDocument(value) });
    assertTemplateExecutor(db, input);
  });
}

export function recordTemplateObservation(db: Database, input: {
  lease: TemplateExecutorLease; bank: TemplatePlanBank; observation: TemplateObservation; now: string;
}): void {
  const value = TemplateObservationSchema.parse(input.observation);
  if (value.planId !== input.lease.planId || value.bankKey !== templateIdentityKey(input.bank.identity)) invalid();
  verifyTemplateApplication({ preview: input.bank.preview, receipt: value.receipt, snapshot: value.snapshot });
  if (value.children.some((child) => !templateEqual(child.target, value.receipt.target)
    || child.request_id !== value.receipt.request_id || !value.receipt.children.some((expected) =>
      expected.child_id === child.child_id && expected.model_id === child.model_id && expected.definition_hash === child.definition_hash))) invalid();
  if (new Set(value.children.map((child) => child.child_id)).size !== value.children.length) invalid();
  db.transaction(() => {
    assertTemplateExecutor(db, input);
    recordTemplateBankReceipt(db, { ...input, receipt: value.receipt });
    db.prepare("INSERT INTO hindsight_template_observations VALUES(:id,:plan,:bank,:generation,:revision,:hash,:json)")
      .run({ id: value.observationId, plan: value.planId, bank: value.bankKey, generation: input.lease.generation,
        revision: input.lease.revision, ...templateDocument(value) });
    assertTemplateExecutor(db, input);
  });
}

export function latestTemplateObservation(db: Database, input: { planId: string; bankKey: string }): TemplateObservation | null {
  const row = db.prepare("SELECT * FROM hindsight_template_observations WHERE plan_id=:plan AND bank_key=:bank ORDER BY rowid DESC LIMIT 1")
    .get({ plan: input.planId, bank: input.bankKey });
  if (!row) return null;
  const value = readTemplateDocument(row, TemplateObservationSchema);
  if (value.planId !== input.planId || value.bankKey !== input.bankKey || value.observationId !== row.observation_id) invalid();
  return value;
}

/** A later snapshot is checked independently by B1 before publication; preserve the genuine receipt even if that read times out. */
function verifyOriginalReceipt(bank: TemplatePlanBank, raw: HindsightTemplateReceipt): HindsightTemplateReceipt {
  const value = normalizeHindsightTemplateReceipt(raw); const { receipt_hash: hash, ...body } = value;
  const request = bank.preview.request;
  const changed = Object.values(request.changes).some((items) => items.length > 0);
  if (templateHash("receipt", body) !== hash || value.request_id !== request.request_id || value.request_hash !== request.request_hash
    || !templateEqual(value.target, request.target) || value.before_snapshot_hash !== request.expected_snapshot.snapshot_hash
    || !templateEqual(value.changes, request.changes) || (changed ? value.journal_after <= value.journal_before : value.journal_after !== value.journal_before)
    || (request.initialization !== null) !== (value.initialization_proof_hash !== null)
    || value.children.length !== request.refresh.length || new Set(value.children.map((child) => child.child_id)).size !== value.children.length
    || value.children.some((child) => !request.refresh.some((expected) => expected.child_id === child.child_id && expected.model_id === child.model_id))) invalid();
  return value;
}
function invalid(): never { throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID"); }
function assertPlanBank(db: Database, planId: string, bank: TemplatePlanBank): void {
  const original = readTemplatePlan(db, planId).banks.find((entry) => templateEqual(entry.identity, bank.identity));
  if (!original || !templateEqual(original, bank)) invalid();
}
