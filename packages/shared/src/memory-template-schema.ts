/**
 * INPUT:  operator template intentions and Core-owned bounded preview/status projections
 * OUTPUT: read-only template methods and exact per-Bank review details, separate from operation execution
 * POS:    shared operator protocol — desired, Native-applied, published, bound and derived state stay independent
 */
import { z } from "zod";
import { HindsightTemplateChangesSchema, HindsightTemplateSnapshotSchema } from "./hindsight-template-schema.ts";
import { HindsightTemplateHashSchema as Hash, HindsightTemplateIdSchema as Id,
  HindsightTemplateModelIdSchema, HindsightTemplateNameSchema, HindsightTemplateTargetSchema } from "./hindsight-template-definition-schema.ts";
import { MemoryTemplateUserChoicesSchema, MemoryTemplateUserRevisionSchema } from "./memory-template-user-schema.ts";
import { MemoryTemplateErrorCodeSchema, MemoryTemplatePhaseSchema } from "./memory-template-operation-schema.ts";

export const MEMORY_TEMPLATE_METHODS = {
  preview: "memory.templates.preview", detail: "memory.templates.preview.bank", status: "memory.templates.status", derived: "memory.templates.derived",
} as const;
export const MEMORY_TEMPLATE_DETAIL_MAX_BYTES = 1_048_576;
const Timestamp = z.iso.datetime({ offset: true });
const SelectionTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("defaults"), globalTemplateRevision: Id, characterTemplateRevision: Id }),
  z.strictObject({ kind: z.literal("bank"), bankId: Id, templateRevision: Id, userChoices: MemoryTemplateUserChoicesSchema.nullable() }),
]);
export const MemoryTemplatePreviewParamsSchema = z.strictObject({
  target: SelectionTarget, enrollment: z.enum(["fresh", "reviewed-existing"]).default("fresh"),
  // Existing directive identities must be chosen explicitly; a matching name cannot authorize adoption.
  directives: z.array(z.strictObject({ bankId: Id,
    items: z.array(z.strictObject({ id: z.uuid(), name: HindsightTemplateNameSchema })).max(64),
  })).max(256).default([]),
  refresh: z.array(z.strictObject({ bankId: Id, modelIds: z.array(HindsightTemplateModelIdSchema).max(64) })).max(256).default([]),
}).superRefine((value, context) => {
  for (const entries of [value.directives, value.refresh]) if (new Set(entries.map((item) => item.bankId)).size !== entries.length) {
    context.addIssue({ code: "custom", message: "duplicate Bank options" });
  }
  for (const entry of value.directives) if (new Set(entry.items.map((item) => item.id)).size !== entry.items.length
    || new Set(entry.items.map((item) => item.name)).size !== entry.items.length) context.addIssue({ code: "custom", message: "duplicate directive selectors" });
  for (const entry of value.refresh) if (new Set(entry.modelIds).size !== entry.modelIds.length) context.addIssue({ code: "custom", message: "duplicate refresh selectors" });
});
export type MemoryTemplatePreviewParams = z.infer<typeof MemoryTemplatePreviewParamsSchema>;
export const MemoryTemplateBankSummarySchema = z.strictObject({
  target: HindsightTemplateTargetSchema, canonicalIdentity: Id, scope: z.enum(["global", "character"]),
  enrollment: z.enum(["fresh", "reviewed-existing", "managed"]),
  templateRevision: Id, userRevision: z.int().min(0), expectedSelectionRevision: z.int().min(0),
  snapshotHash: Hash, effectiveDefinitionHash: Hash,
  configChanges: z.int().min(0).max(4), modelChanges: z.int().min(0).max(64), directiveChanges: z.int().min(0).max(64),
  deletions: z.int().min(0).max(128), refreshChildren: z.int().min(0).max(64),
});
export type MemoryTemplateBankSummary = z.infer<typeof MemoryTemplateBankSummarySchema>;
export const MemoryTemplatePreviewSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready"), previewId: z.uuid(), previewHash: Hash, expiresAt: Timestamp,
    banks: z.array(MemoryTemplateBankSummarySchema).min(1).max(256), changesDefaults: z.boolean() }),
  z.strictObject({ state: z.literal("refused"), reason: MemoryTemplateErrorCodeSchema, bankId: Id.nullable(),
    // Actual authenticated before-images include name-match IDs; choosing enrollment never invents legacy ownership.
    review: HindsightTemplateSnapshotSchema.nullable() }),
]);
export type MemoryTemplatePreview = z.infer<typeof MemoryTemplatePreviewSchema>;
export const MemoryTemplateDetailParamsSchema = z.strictObject({ previewId: z.uuid(), previewHash: Hash, bankId: Id });
export const MemoryTemplateDetailSchema = z.strictObject({
  previewId: z.uuid(), previewHash: Hash, bank: MemoryTemplateBankSummarySchema,
  before: HindsightTemplateSnapshotSchema, changes: HindsightTemplateChangesSchema,
  deletions: z.array(z.strictObject({ kind: z.enum(["model", "directive"]), id: Id,
    historyCount: z.int().min(0), dependencyCount: z.int().min(0), hasGeneratedContent: z.boolean() })).max(128),
  refresh: z.array(z.strictObject({ modelId: HindsightTemplateModelIdSchema, childId: z.uuid() })).max(64),
});
export type MemoryTemplateDetail = z.infer<typeof MemoryTemplateDetailSchema>;
export const MemoryTemplateStatusParamsSchema = z.strictObject({ planId: z.uuid().optional(), bankId: Id.optional() });
export const MemoryTemplateBankStatusSchema = z.strictObject({
  bankId: Id, canonicalIdentity: Id, scope: z.enum(["global", "character"]), target: HindsightTemplateTargetSchema.nullable(),
  enrollment: z.enum(["untracked", "enrolled", "managed"]),
  selected: z.strictObject({ revision: z.int().min(1), templateRevision: Id, enrollmentRevision: z.int().min(1),
    effectiveDefinitionHash: Hash, receiptHash: Hash, user: MemoryTemplateUserRevisionSchema }).nullable(),
  // This is persisted desired history, not an inference from the effective Native field values.
  latestUser: MemoryTemplateUserRevisionSchema.nullable(),
  pending: z.strictObject({ planId: z.uuid(), templateRevision: Id, userRevision: z.int().min(0) }).nullable(),
});
export const MemoryTemplateBankProgressSchema = z.strictObject({
  bank: MemoryTemplateBankSummarySchema, dispatched: z.boolean(), receiptHash: Hash.nullable(),
  selectionRevision: z.int().min(1).nullable(),
  derived: z.array(z.strictObject({ childId: z.uuid(), modelId: HindsightTemplateModelIdSchema,
    source: z.literal("rollout_record"), observedAt: Timestamp.nullable(),
    state: z.enum(["unknown", "pending", "processing", "completed", "superseded", "failed"]) })).max(64),
});
export const MemoryTemplateStatusSchema = z.strictObject({
  // supported describes the last committed runtime admission. A fresh optional-capability probe is a read-only preview.
  supported: z.boolean(), previewAvailable: z.boolean(), holdPlanId: z.uuid().nullable(), boundSelectionIdentity: Hash.nullable(),
  recoverPlanId: z.uuid().nullable(),
  recoverUnavailableReason: z.enum(["no_plan", "busy", "active", "already_bound", "cancelled", "quarantined", "stale", "unavailable"]).nullable(),
  defaults: z.strictObject({ revision: z.int().min(1), globalTemplateRevision: Id, characterTemplateRevision: Id }).nullable(),
  catalogs: z.array(z.strictObject({ revision: Id, scope: z.enum(["global", "character"]) })).max(64),
  bank: MemoryTemplateBankStatusSchema.nullable(),
  plan: z.strictObject({ planId: z.uuid(), originalOperationId: z.uuid(), phase: MemoryTemplatePhaseSchema,
    hold: z.enum(["active", "published", "cancelled", "quarantined"]), executorRevision: z.int().min(0),
    publicationId: z.uuid().nullable(), errorCode: MemoryTemplateErrorCodeSchema.nullable(),
    banks: z.array(MemoryTemplateBankProgressSchema).min(1).max(256),
  }).nullable(),
});
export type MemoryTemplateStatus = z.infer<typeof MemoryTemplateStatusSchema>;
