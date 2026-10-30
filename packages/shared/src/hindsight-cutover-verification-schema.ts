/**
 * INPUT:  native cutover_verification.py version 1.0.0 requests and finite evidence streams
 * OUTPUT: strict D78 candidate, maintenance certificate and typed requirement/outcome contracts
 * POS:    shared provider wire — first activation proof; independent of G1 completion
 */
import { z } from "zod";
import { HINDSIGHT_CURRENT_STATE_ENCODING, HINDSIGHT_CURRENT_STATE_VERSION } from "./hindsight-current-state-schema.ts";
import { HindsightSnapshotMetadataWireSchema, HindsightSnapshotPageWireSchema } from "./hindsight-native-snapshot-schema.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/); const Id = z.string().min(1).max(256);
const Count = z.int().min(0); const Revision = z.int().min(1); const Time = z.iso.datetime({ offset: true });
const Version = { contract_version: z.literal(HINDSIGHT_CURRENT_STATE_VERSION), encoding: z.literal(HINDSIGHT_CURRENT_STATE_ENCODING) };
const Identity = { verification_id: z.uuid(), request_hash: Hash, transfer_operation_id: z.uuid(),
  transfer_request_hash: Hash, transfer_result_hash: Hash, local_manifest_digest: Hash, source_bank_id: Id,
  provider_lineage: z.uuid(), bank_generation: z.uuid() };
export const HindsightCutoverVerificationRequestSchema = z.strictObject({ ...Version, ...Identity });
export type HindsightCutoverVerificationRequest = z.infer<typeof HindsightCutoverVerificationRequestSchema>;
export const HindsightCutoverObjectWitnessSchema = z.strictObject({
  object_kind: z.enum(["bank", "document", "memory_unit", "mental_model", "directive", "chunk", "document_content", "model_tracking", "effective_policy"]),
  object_id: Id, object_revision: Revision.nullable(), payload_hash: Hash, material_hash: Hash,
});
export const HindsightCutoverLifecycleInputSchema = z.strictObject({
  event_id: Hash, memory_id: Id, change: z.enum(["invalidated", "deleted", "restored", "scope_exit", "scope_entry"]),
  before: HindsightCutoverObjectWitnessSchema.nullable(), after: HindsightCutoverObjectWitnessSchema.nullable(),
  journal_cursor: Count.nullable(), provenance: z.enum(["transfer", "journal", "candidate"]),
});
export const HindsightCutoverRequirementSchema = z.strictObject({
  requirement_key: Hash, kind: z.enum(["source_scope", "mental_model"]), input: HindsightCutoverObjectWitnessSchema,
  scope_tags: z.array(z.string()).nullable(), policy_hash: Hash,
}).superRefine((value, context) => {
  if ((value.kind === "source_scope") !== (value.scope_tags !== null)) context.addIssue({ code: "custom", message: "requirement scope mismatch" });
});
export type HindsightCutoverRequirement = z.infer<typeof HindsightCutoverRequirementSchema>;
const OutcomeReason = z.enum(["native_committed", "native_unchanged", "native_no_action", "native_irrelevant", "native_security_rejection",
  "native_duplicate", "native_scope_limit", "observations_disabled"]);
const RequirementRecord = z.strictObject({ ordinal: Count, record_kind: z.literal("requirement"), requirement: HindsightCutoverRequirementSchema });
const OutcomeRecord = z.strictObject({ ordinal: Count, record_kind: z.literal("outcome"), requirement_key: Hash,
  disposition: z.enum(["committed", "no_op", "not_required"]), reason: OutcomeReason, verified_cursor: Count,
  action_keys: z.array(Hash), input_manifest_hash: Hash });
const InputRecord = z.strictObject({ ordinal: Count, record_kind: z.literal("input"), requirement_key: Hash,
  input_manifest_hash: Hash,
  role: z.enum(["source", "eligible", "retrieved", "consumed", "lifecycle", "definition", "tracking"]),
  witness: HindsightCutoverObjectWitnessSchema.nullable(), lifecycle: HindsightCutoverLifecycleInputSchema.nullable(),
}).superRefine((value, context) => {
  if (value.role === "lifecycle" ? value.lifecycle === null || value.witness !== null : value.witness === null || value.lifecycle !== null) {
    context.addIssue({ code: "custom", message: "input witness shape mismatch" });
  }
});
const Batch = z.strictObject({ provider_lineage: z.uuid(), bank_generation: z.uuid(), batch_id: z.uuid(),
  first_cursor: Revision, last_cursor: Revision, size: Revision });
const ActionRecord = z.strictObject({ ordinal: Count, record_kind: z.literal("action"), action_key: Hash,
  step_key: Hash, plan_id: z.uuid(), action_index: Count,
  requirement_keys: z.array(Hash), action: z.enum(["observation_create", "observation_update", "observation_delete",
    "observation_create_fold", "observation_update_fold", "native_decision", "model_refresh"]),
  disposition: z.enum(["committed", "no_op"]), reason: OutcomeReason, verified_cursor: Count,
  journal_batch: Batch.nullable(), outputs: z.array(HindsightCutoverObjectWitnessSchema), input_manifest_hash: Hash });
type TagGroup = { tags: string[]; match: "any" | "all" | "any_strict" | "all_strict" | "exact" }
  | { and: TagGroup[] } | { or: TagGroup[] } | { not: TagGroup };
const TagsMatch = z.enum(["any", "all", "any_strict", "all_strict", "exact"]);
const TagGroupSchema: z.ZodType<TagGroup> = z.lazy(() => z.union([
  z.strictObject({ tags: z.array(z.string()), match: TagsMatch }), z.strictObject({ and: z.array(TagGroupSchema) }),
  z.strictObject({ or: z.array(TagGroupSchema) }), z.strictObject({ not: TagGroupSchema }),
]));
export const HindsightCutoverInputWindowSchema = z.strictObject({
  created_after: Time.nullable(), created_before: Time.nullable(), watermark: Time.nullable(),
});
export type HindsightCutoverInputWindow = z.infer<typeof HindsightCutoverInputWindowSchema>;
const ModelRecord = z.strictObject({ ordinal: Count, record_kind: z.literal("model"), requirement_key: Hash,
  requested_mode: z.enum(["full", "delta"]), effective_mode: z.enum(["full", "delta"]), mode_fallback_reason: z.string().nullable(),
  outcome: z.enum(["content_written", "content_preserved_no_new_facts", "refresh_failed_empty_candidate", "refresh_failed_delta_not_applied"]),
  scope: z.strictObject({ tags: z.array(z.string()).nullable(), tags_match: TagsMatch, tag_groups: z.array(TagGroupSchema).nullable(),
    fact_types: z.array(z.string()).nullable(), exclude_mental_models: z.boolean(), exclude_mental_model_ids: z.array(z.string()) }),
  window: HindsightCutoverInputWindowSchema,
  authored_baseline_hash: Hash, definition_hash: Hash, tracking_hash: Hash, eligible_hash: Hash, retrieved_hash: Hash,
  consumed_hash: Hash, lifecycle_hash: Hash, prompt_hash: Hash.nullable(), prompt_truncated: z.boolean(),
  applied_operation_count: Count, skipped_operation_count: Count });
export const HindsightCutoverEvidenceRecordSchema = z.discriminatedUnion("record_kind", [RequirementRecord, OutcomeRecord, InputRecord, ActionRecord, ModelRecord]);
export type HindsightCutoverEvidenceRecord = z.infer<typeof HindsightCutoverEvidenceRecordSchema>;
export const HindsightCutoverCertificateSchema = z.strictObject({ ...Version, ...Identity, bank_id: Id,
  candidate_hash: Hash, candidate_cursor: Count, required_set_hash: Hash, source_scope_count: Count, model_count: Count,
  policy_hash: Hash, evidence: z.strictObject({ page_size: z.literal(128), total_pages: Revision, total_records: Count,
    counts: z.strictObject({ requirements: Count, outcomes: Count, inputs: Count, actions: Count, models: Count }),
    records_hash: Hash, page_hashes: z.array(Hash) }), snapshot: HindsightSnapshotMetadataWireSchema,
  snapshot_records_hash: Hash, snapshot_retained: z.literal(true), certificate_hash: Hash });
export type HindsightCutoverCertificate = z.infer<typeof HindsightCutoverCertificateSchema>;
export const HindsightCutoverEvidencePageSchema = z.strictObject({ verification_id: z.uuid(), bank_id: Id,
  provider_lineage: z.uuid(), bank_generation: z.uuid(), certificate_hash: Hash, page_number: Count,
  total_pages: Revision, page_hash: Hash, records: z.array(HindsightCutoverEvidenceRecordSchema).max(128) });
export type HindsightCutoverEvidencePage = z.infer<typeof HindsightCutoverEvidencePageSchema>;
const Reason = z.enum(["invalid_request_hash", "request_conflict", "transfer_not_found", "transfer_mismatch", "bank_not_found",
  "generation_mismatch", "unsupported_storage", "verification_not_found", "revision_conflict", "page_not_found",
  "evidence_corrupt", "source_changed", "target_changed", "source_missing", "target_missing", "policy_changed",
  "definition_changed", "journal_expired", "journal_gap", "input_changed", "input_unavailable",
  "native_consolidation_failed", "native_model_failed", "partial_native_actions", "delta_not_applied",
  "delta_operations_skipped", "lifecycle_coverage_unavailable", "prompt_input_incomplete", "snapshot_expired",
  "attempt_replaced", "candidate_changed", "native_failure", "accepted_work_unresolved", "operation_refused"]);
export const HindsightCutoverVerificationStatusSchema = z.strictObject({ ...Version, ...Identity, bank_id: Id,
  state: z.enum(["prepared", "running", "incomplete", "complete", "stale"]), revision: Revision,
  candidate_hash: Hash, required_set_hash: Hash, source_scope_count: Count, model_count: Count,
  reasons: z.array(Reason), certificate: HindsightCutoverCertificateSchema.nullable(),
}).superRefine((value, context) => {
  if ((value.state === "complete") !== (value.certificate !== null)) context.addIssue({ code: "custom", message: "verification completion mismatch" });
});
export type HindsightCutoverVerificationStatus = z.infer<typeof HindsightCutoverVerificationStatusSchema>;
export const HindsightCutoverVerificationFailureSchema = z.strictObject({ error: z.literal("cutover_verification_refused"), reason: Reason });
export type HindsightCutoverVerificationFailure = z.infer<typeof HindsightCutoverVerificationFailureSchema>;
export const HindsightCurrentVerificationCandidateSchema = z.strictObject({ schemaVersion: z.literal(1), candidateId: Hash,
  preparationId: Hash, request: HindsightCutoverVerificationRequestSchema, status: HindsightCutoverVerificationStatusSchema });
export type HindsightCurrentVerificationCandidate = z.infer<typeof HindsightCurrentVerificationCandidateSchema>;
export const HindsightCurrentVerificationEvidenceSchema = z.strictObject({ schemaVersion: z.literal(1), evidenceId: Hash,
  preparationId: Hash, candidateId: Hash, request: HindsightCutoverVerificationRequestSchema, status: HindsightCutoverVerificationStatusSchema,
  pages: z.array(HindsightCutoverEvidencePageSchema), snapshotPages: z.array(HindsightSnapshotPageWireSchema) });
export type HindsightCurrentVerificationEvidence = z.infer<typeof HindsightCurrentVerificationEvidenceSchema>;
