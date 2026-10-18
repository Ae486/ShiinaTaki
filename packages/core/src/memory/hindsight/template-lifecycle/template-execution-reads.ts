/**
 * INPUT:  Core SQLite execution evidence and exact plan/epoch/request identities
 * OUTPUT: corruption-checked read-only plan, hold, admission and publication lookups
 * POS:    durable template reads shared by boot, operations and runtime; observation never resumes execution
 */
import { z } from "zod";
import { MemoryTemplateRequestSchema, type MemoryTemplateRequest } from "@taki/shared";
import type { Database } from "../../../db/sqlite.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";
import { readTemplateDocument } from "./template-store-documents.ts";
import { TemplatePlanSchema, TemplatePublicationSchema, type TemplatePlan, type TemplatePreviewPlan } from "./template-plan-schema.ts";

export const TemplateHoldSchema = z.strictObject({
  planId: z.uuid(), epochId: z.string().min(1), originalOperationId: z.uuid(),
  state: z.enum(["active", "published", "cancelled", "quarantined"]), publicationId: z.uuid().nullable(),
});
export type TemplateHold = z.infer<typeof TemplateHoldSchema>;

export function hasTemplateExecutionStorage(db: Database): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='hindsight_template_plans'").get();
}
export function templatePlanHash(value: TemplatePreviewPlan): string {
  return templateHash("definition", { record_kind: "core-template-plan.v1", plan: value });
}
export function readTemplatePlan(db: Database, planId: string): TemplatePlan {
  const row = db.prepare("SELECT * FROM hindsight_template_plans WHERE plan_id=:id").get({ id: z.uuid().parse(planId) });
  if (!row) throw new Error("MEMORY_TEMPLATE_PLAN_NOT_FOUND");
  const value = readTemplateDocument(row, TemplatePlanSchema);
  const preview: TemplatePreviewPlan = { planId: value.planId, bootId: value.bootId, createdAt: value.createdAt,
    expiresAt: value.expiresAt, params: value.params, guard: value.guard, banks: value.banks };
  if (templatePlanHash(preview) !== value.planHash || row.plan_hash !== value.planHash || row.operation_id !== value.originalOperationId
    || row.epoch_id !== value.guard.epochId || row.plan_id !== value.planId) invalid();
  return value;
}
export function readTemplateHold(db: Database, planId: string): TemplateHold | null {
  if (!hasTemplateExecutionStorage(db)) return null;
  const row = db.prepare(`SELECT h.*, p.operation_id FROM hindsight_template_holds h
    JOIN hindsight_template_plans p USING(plan_id) WHERE h.plan_id=:id`).get({ id: planId });
  return row ? TemplateHoldSchema.parse({ planId: row.plan_id, epochId: row.epoch_id, originalOperationId: row.operation_id,
    state: row.state, publicationId: row.publication_id }) : null;
}
export function activeTemplateHold(db: Database, epochId: string): TemplateHold | null {
  if (!hasTemplateExecutionStorage(db)) return null;
  const row = db.prepare("SELECT plan_id FROM hindsight_template_holds WHERE epoch_id=:epoch AND state='active'").get({ epoch: epochId });
  return row ? readTemplateHold(db, String(row.plan_id)) : null;
}
export function findTemplateAdmission(db: Database, request: MemoryTemplateRequest): { operationId: string; planId: string } | null {
  const value = MemoryTemplateRequestSchema.parse(request);
  const row = db.prepare("SELECT * FROM hindsight_template_admissions WHERE request_id=:id").get({ id: value.requestId });
  if (!row) return null;
  const original = MemoryTemplateRequestSchema.parse(JSON.parse(String(row.request_json)));
  if (templateHash("definition", original) !== row.request_hash) invalid();
  if (!templateEqual(original, value)) throw new Error("MEMORY_TEMPLATE_CONFLICT");
  return { operationId: z.uuid().parse(row.operation_id), planId: z.uuid().parse(row.plan_id) };
}
export function readTemplatePublication(db: Database, planId: string) {
  const row = db.prepare("SELECT * FROM hindsight_template_publications WHERE plan_id=:id").get({ id: planId });
  if (!row) return null;
  const value = readTemplateDocument(row, TemplatePublicationSchema);
  if (value.planId !== planId || value.publicationId !== row.publication_id || value.selectionIdentity !== row.selection_identity) invalid();
  return value;
}
export function templateHasDispatch(db: Database, planId: string, bankKey?: string): boolean {
  return !!db.prepare(`SELECT 1 FROM hindsight_template_dispatches WHERE plan_id=:id ${bankKey === undefined ? "" : "AND bank_key=:bank"} LIMIT 1`)
    .get(bankKey === undefined ? { id: planId } : { id: planId, bank: bankKey });
}
function invalid(): never { throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID"); }
