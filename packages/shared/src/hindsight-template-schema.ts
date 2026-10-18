/**
 * INPUT:  bounded template lifecycle requests and authenticated Native evidence
 * OUTPUT: strict snapshot, conditional mutation, receipt, derived-job and later evidence contracts
 * POS:    shared Hindsight wire — lifecycle-v1; no operation orchestration or positive evidence fabrication
 */
import { z } from "zod";
import {
  HINDSIGHT_TEMPLATE_VERSION, HindsightTemplateConfigEntrySchema, HindsightTemplateConfigKeySchema,
  HindsightTemplateDirectiveDefinitionSchema, HindsightTemplateHashSchema as Hash,
  HindsightTemplateIdSchema as Id, HindsightTemplateModelDefinitionSchema,
  HindsightTemplateModelIdSchema as ModelId, HindsightTemplateNameSchema as Name,
  HindsightTemplatePresenceSchema, HindsightTemplateSelectorsSchema, HindsightTemplateTargetSchema, isHindsightTemplateConfigValue,
} from "./hindsight-template-definition-schema.ts";

const UUID = z.uuid().transform((value) => value.toLowerCase());
const Revision = z.int().min(1);
const Count = z.int().min(0);
const Version = { contract_version: z.literal(HINDSIGHT_TEMPLATE_VERSION) };
export const HindsightTemplateObjectProofSchema = z.strictObject({
  revision: Revision, payload_hash: Hash, definition_hash: Hash, deletion_hash: Hash,
  history_count: Count, dependency_count: Count, has_generated_content: z.boolean(),
});
const ModelState = z.strictObject({
  id: ModelId, definition: HindsightTemplateModelDefinitionSchema.nullable(), proof: HindsightTemplateObjectProofSchema.nullable(),
}).refine((value) => (value.definition === null) === (value.proof === null) && (!value.definition || value.id === value.definition.id));
const DirectiveState = z.strictObject({
  id: UUID, name: Name, definition: HindsightTemplateDirectiveDefinitionSchema.nullable(),
  proof: HindsightTemplateObjectProofSchema.nullable(), name_matches: z.array(UUID).max(64),
}).refine((value) => (value.definition === null) === (value.proof === null) && (!value.definition || value.id === value.definition.id)
  && new Set(value.name_matches).size === value.name_matches.length);
export const HindsightTemplateSnapshotRequestSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, selectors: HindsightTemplateSelectorsSchema,
});
export const HindsightTemplateSnapshotSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, selectors: HindsightTemplateSelectorsSchema,
  config: z.array(HindsightTemplateConfigEntrySchema).max(4), models: z.array(ModelState).max(64),
  directives: z.array(DirectiveState).max(64), snapshot_hash: Hash,
});
export type HindsightTemplateSnapshot = z.infer<typeof HindsightTemplateSnapshotSchema>;
const ConfigChange = z.strictObject({ key: HindsightTemplateConfigKeySchema, stored: HindsightTemplatePresenceSchema })
  .refine((value) => value.stored.kind !== "value" || isHindsightTemplateConfigValue(value.key, value.stored.value), "invalid template config value");
const ModelChange = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("upsert"), definition: HindsightTemplateModelDefinitionSchema }),
  z.strictObject({ kind: z.literal("delete"), id: ModelId, deletion_hash: Hash }),
]);
const DirectiveChange = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("upsert"), definition: HindsightTemplateDirectiveDefinitionSchema }),
  z.strictObject({ kind: z.literal("delete"), id: UUID, deletion_hash: Hash }),
]);
export const HindsightTemplateChangesSchema = z.strictObject({
  config: z.array(ConfigChange).max(4), models: z.array(ModelChange).max(64), directives: z.array(DirectiveChange).max(64),
});
export type HindsightTemplateChanges = z.infer<typeof HindsightTemplateChangesSchema>;
export const HindsightTemplateApplyRequestSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, request_id: UUID, request_hash: Hash,
  expected_snapshot: HindsightTemplateSnapshotSchema, changes: HindsightTemplateChangesSchema,
  refresh: z.array(z.strictObject({ model_id: ModelId, child_id: UUID })).max(64),
  // This asks Native to establish actual pristine provenance. It grants no authority
  // and cannot assert that earlier imports or provider work completed.
  initialization: z.strictObject({ template_revision: Id, template_hash: Hash }).nullable(),
}).superRefine((value, context) => {
  const ids = [value.changes.config.map((item) => item.key),
    value.changes.models.map((item) => item.kind === "upsert" ? item.definition.id : item.id),
    value.changes.directives.map((item) => item.kind === "upsert" ? item.definition.id : item.id),
    value.refresh.map((item) => item.model_id), value.refresh.map((item) => item.child_id)];
  if (ids.some((items) => new Set(items).size !== items.length)) context.addIssue({ code: "custom", message: "duplicate changes or children" });
  if (value.target.bank_id !== value.expected_snapshot.target.bank_id
    || value.target.bank_generation !== value.expected_snapshot.target.bank_generation
    || value.target.provider_lineage !== value.expected_snapshot.target.provider_lineage) {
    context.addIssue({ code: "custom", message: "snapshot target mismatch" });
  }
});
export type HindsightTemplateApplyRequest = z.infer<typeof HindsightTemplateApplyRequestSchema>;
export const HindsightTemplateChildSchema = z.strictObject({
  child_id: UUID, model_id: ModelId, definition_hash: Hash, object_revision: Revision, object_payload_hash: Hash,
});
export const HindsightTemplateReceiptSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, request_id: UUID, request_hash: Hash,
  before_snapshot_hash: Hash, after_snapshot_hash: Hash, changes: HindsightTemplateChangesSchema,
  children: z.array(HindsightTemplateChildSchema).max(64), journal_before: Count, journal_after: Count,
  initialization_proof_hash: Hash.nullable(), receipt_hash: Hash,
});
export type HindsightTemplateReceipt = z.infer<typeof HindsightTemplateReceiptSchema>;
export const HindsightTemplateResultRequestSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, request_id: UUID, request_hash: Hash,
});
export const HindsightTemplateRefreshResultRequestSchema = HindsightTemplateResultRequestSchema.extend({ child_id: UUID });
export const HindsightTemplateResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("absent") }),
  z.strictObject({ state: z.literal("committed"), receipt: HindsightTemplateReceiptSchema }),
]);
export const HindsightTemplateRefreshResultSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, request_id: UUID, child_id: UUID, model_id: ModelId,
  state: z.enum(["pending", "processing", "completed", "superseded", "failed"]),
  definition_hash: Hash, result_revision: Revision.nullable(), result_payload_hash: Hash.nullable(),
});
export const HindsightTemplateFailureSchema = z.strictObject({
  error: z.literal("template_lifecycle_refused"), reason: z.enum([
    "invalid_request", "request_too_large", "response_too_large", "unsupported_storage", "unsupported_value",
    "bank_not_found", "generation_mismatch", "request_conflict", "snapshot_conflict", "resource_conflict",
    "operation_refused", "field_refused", "provider_unavailable", "receipt_corrupt", "initialization_refused",
    "child_not_found", "claim_lost", "definition_superseded",
  ]),
});
// B2/B3 own real production and consumption. Declaring these finite shapes never
// authorizes callers to supply trusted labels or treat missing backup proof as empty.
export const HindsightTemplateLabelEvidenceSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, unit_id: UUID, unit_revision: Revision, unit_payload_hash: Hash,
  group_key: z.literal("taki-layer"), group_definition_hash: Hash, value: Name,
  scope: z.enum(["global", "character"]), producer: z.literal("taki-structured-label-v1"),
});
export const HindsightTemplateLabelEvidenceRequestSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema,
  units: z.array(z.strictObject({ unit_id: UUID, unit_revision: Revision, unit_payload_hash: Hash })).max(256),
});
export const HindsightTemplateLabelEvidenceResultSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, evidence: z.array(HindsightTemplateLabelEvidenceSchema).max(256),
});
export const HindsightTemplateBackupEvidenceSchema = z.strictObject({
  ...Version, target: HindsightTemplateTargetSchema, receipt_count: Count, receipt_set_hash: Hash,
  latest_request_id: UUID.nullable(), latest_receipt_hash: Hash.nullable(),
  effective_definition_hash: Hash, initialization_proof_hash: Hash.nullable(),
});
