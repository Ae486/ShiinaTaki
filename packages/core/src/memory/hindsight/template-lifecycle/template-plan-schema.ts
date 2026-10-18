/**
 * INPUT:  genuine Native previews and captured Core configuration/Bank inventory
 * OUTPUT: validated immutable rollout plans and exact dispatch/readback/publication documents
 * POS:    private Core execution storage — Shared owns the operator wire, B1 owns composition evidence
 */
import { z } from "zod";
import {
  HindsightBankSetupProjectionSchema, HindsightTemplateApplyRequestSchema, HindsightTemplateHashSchema as Hash,
  HindsightTemplateIdSchema as Id, HindsightTemplateReceiptSchema, HindsightTemplateRefreshResultSchema,
  HindsightTemplateSnapshotSchema, MemoryTemplateBankSummarySchema, MemoryTemplatePreviewParamsSchema,
  TakiApplicationNamespaceSchema,
} from "@taki/shared";
import { TemplateCatalogEntrySchema } from "./template-catalog.ts";
import { TemplateEnrollmentSchema } from "./template-enrollment.ts";
import { TemplateBankIdentitySchema, TemplateUserRevisionSchema } from "./template-overlay-schema.ts";
import { TemplateProjectionSchema } from "./template-projection.ts";

const Timestamp = z.iso.datetime({ offset: true });
export const TemplatePlanPreviewSchema = z.strictObject({
  request: HindsightTemplateApplyRequestSchema, projection: TemplateProjectionSchema,
  effectiveDefinitionHash: Hash, templateRevision: Id, userRevision: z.int().min(0), enrollmentRevision: z.int().min(1),
  consequences: z.strictObject({ deletions: z.array(z.strictObject({ kind: z.enum(["model", "directive"]), id: Id,
    historyCount: z.int().min(0), dependencyCount: z.int().min(0), hasGeneratedContent: z.boolean() })).max(128),
  providerWork: HindsightTemplateApplyRequestSchema.shape.refresh }),
});
export const TemplatePlanBankSchema = z.strictObject({
  identity: TemplateBankIdentitySchema, namespace: TakiApplicationNamespaceSchema, summary: MemoryTemplateBankSummarySchema,
  previousEnrollmentRevision: z.int().min(0), previousUserRevision: z.int().min(0).nullable(),
  expectedSelectionRevision: z.int().min(0), enrollment: TemplateEnrollmentSchema,
  usersToAppend: z.array(TemplateUserRevisionSchema).max(2), template: TemplateCatalogEntrySchema.nullable(),
  preview: TemplatePlanPreviewSchema,
});
export type TemplatePlanBank = z.infer<typeof TemplatePlanBankSchema>;
export const TemplatePlanGuardSchema = z.strictObject({
  epochId: Id, providerLineage: z.uuid(), configFingerprint: Hash, configRevision: z.int().min(0),
  secretMarker: Hash, connectionRevision: z.int().min(0), manifestHash: Hash, defaultsRevision: z.int().min(0),
  provisionBankId: Id.nullable(),
  banks: z.array(z.strictObject({ setup: HindsightBankSetupProjectionSchema, identity: TemplateBankIdentitySchema,
    namespace: TakiApplicationNamespaceSchema })).min(1).max(256),
});
export type TemplatePlanGuard = z.infer<typeof TemplatePlanGuardSchema>;
export const TemplatePreviewPlanSchema = z.strictObject({
  planId: z.uuid(), bootId: Id, createdAt: Timestamp, expiresAt: Timestamp,
  params: MemoryTemplatePreviewParamsSchema, guard: TemplatePlanGuardSchema, banks: z.array(TemplatePlanBankSchema).min(1).max(256),
});
export type TemplatePreviewPlan = z.infer<typeof TemplatePreviewPlanSchema>;
export const TemplatePlanSchema = TemplatePreviewPlanSchema.extend({
  originalOperationId: z.uuid(), originalRequestId: z.uuid(), planHash: Hash,
}).superRefine((value, context) => {
  const ids = value.banks.map((bank) => bank.identity.target.bank_id);
  if (new Set(ids).size !== ids.length || value.banks.some((bank) => bank.identity.target.provider_lineage !== value.guard.providerLineage)) {
    context.addIssue({ code: "custom", message: "invalid fixed Bank inventory" });
  }
});
export type TemplatePlan = z.infer<typeof TemplatePlanSchema>;
export const TemplateDispatchSchema = z.strictObject({
  dispatchId: z.uuid(), planId: z.uuid(), bankKey: Hash, requestId: z.uuid(), requestHash: Hash,
  generation: z.int().min(1), executorToken: z.uuid(), dispatchedAt: Timestamp,
});
export const TemplateObservationSchema = z.strictObject({
  observationId: z.uuid(), planId: z.uuid(), bankKey: Hash, snapshot: HindsightTemplateSnapshotSchema,
  receipt: HindsightTemplateReceiptSchema, children: z.array(HindsightTemplateRefreshResultSchema).max(64),
  verifiedAt: Timestamp,
});
export type TemplateObservation = z.infer<typeof TemplateObservationSchema>;
export const TemplatePublicationSchema = z.strictObject({
  publicationId: z.uuid(), planId: z.uuid(), planHash: Hash, epochId: Id, selectionIdentity: Hash,
  selections: z.array(z.strictObject({ identity: TemplateBankIdentitySchema, revision: z.int().min(1), receiptHash: Hash })).min(1).max(256),
  defaultsRevision: z.int().min(0), connectionRevision: z.int().min(0), committedAt: Timestamp,
});
export type TemplatePublication = z.infer<typeof TemplatePublicationSchema>;
