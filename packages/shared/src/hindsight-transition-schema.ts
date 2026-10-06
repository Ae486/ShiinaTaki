/**
 * INPUT:  authenticated taki-transition-v1 native control, final proofs and history
 * OUTPUT: strict independent transition wire contracts, including unused-scope evidence
 * POS:    shared provider protocol — supplies producers; does not publish Core authority
 */
import { z } from "zod";
import { TakiApplicationHashSchema as Hash, TakiApplicationIdSchema as Id, TakiApplicationCountSchema as Count,
  TakiApplicationRevisionSchema as Revision, TakiApplicationTimeSchema as Time } from "./hindsight-application-primitives-schema.ts";
import { HindsightSnapshotMetadataWireSchema } from "./hindsight-native-snapshot-schema.ts";
import { TakiApplicationReadBundleManifestSchema } from "./hindsight-application-read-schema.ts";
import { HindsightCutoverCertificateSchema, HindsightCutoverObjectWitnessSchema } from "./hindsight-cutover-verification-schema.ts";

export const HINDSIGHT_TRANSITION_BUILD = "taki-memory-hindsight-0.9.0-transitions-v1";
export const HINDSIGHT_TRANSITION_VERSION = "1.0.0";
export const HINDSIGHT_TRANSITION_MAX_BYTES = 16 * 1024 * 1024;
const Protocol = z.literal("taki-transition-v1").default("taki-transition-v1");
export const HindsightTransitionUnusedScopeSchema = z.strictObject({ kind: z.literal("unused-scope").default("unused-scope"),
  bank_id: Id, provider_lineage: z.uuid(), bank_generation: z.uuid(), creation_id: z.uuid(), native_cursor: Revision,
  template_hash: Hash, history_hash: Hash, baseline_hash: Hash, proof_hash: Hash });
export type HindsightTransitionUnusedScope = z.infer<typeof HindsightTransitionUnusedScopeSchema>;
export const HindsightTransitionAcquireSchema = z.strictObject({ protocol: Protocol, transition_id: z.uuid(), attempt_id: z.uuid(),
  provider_lineage: z.uuid(), bank_generation: z.uuid(), direction: z.enum(["return-local", "reenter-hindsight"]),
  baseline_transition_id: z.uuid().nullable().default(null), baseline_proof_hash: Hash.nullable().default(null),
  unused_scope: HindsightTransitionUnusedScopeSchema.nullable().default(null), request_hash: Hash,
}).superRefine((value, context) => {
  const kinds = Number(value.baseline_transition_id !== null) + Number(value.unused_scope !== null);
  if ((value.baseline_transition_id === null) !== (value.baseline_proof_hash === null)
    || kinds !== Number(value.direction === "reenter-hindsight")) {
    context.addIssue({ code: "custom", message: "transition requires exactly its admitted baseline kind" });
  }
});
export type HindsightTransitionAcquire = z.infer<typeof HindsightTransitionAcquireSchema>;
export const HindsightTransitionExecutorSchema = z.strictObject({ transition_id: z.uuid(), attempt_id: z.uuid(),
  generation: Revision, fence_token: z.uuid() });
export type HindsightTransitionExecutor = z.infer<typeof HindsightTransitionExecutorSchema>;
export const HindsightTransitionClaimSchema = z.strictObject({ expected_revision: Revision, attempt_id: z.uuid() });
export type HindsightTransitionClaim = z.infer<typeof HindsightTransitionClaimSchema>;
export const HindsightTransitionProofSchema = z.strictObject({ protocol: Protocol, certificate_id: z.uuid(), bank_id: Id,
  provider_lineage: z.uuid(), bank_generation: z.uuid(), executor: HindsightTransitionExecutorSchema, request_hash: Hash,
  delta_result_hash: Hash.nullable().default(null), unused_scope_hash: Hash.nullable().default(null),
  maintenance_input_hash: Hash, maintenance_outcome_hash: Hash, evidence: HindsightCutoverCertificateSchema.shape.evidence,
  not_required: z.array(z.strictObject({ reason: z.literal("source_query_absent"), witness: HindsightCutoverObjectWitnessSchema })),
  native_snapshot: HindsightSnapshotMetadataWireSchema, application_snapshot: TakiApplicationReadBundleManifestSchema,
  native_records_hash: Hash, application_records_hash: Hash, auxiliary_records_hash: Hash,
  auxiliary_page_hashes: z.array(Hash), baseline_hash: Hash, proof_hash: Hash });
export type HindsightTransitionProof = z.infer<typeof HindsightTransitionProofSchema>;
export const HindsightTransitionOutcomeRequestSchema = z.strictObject({ executor: HindsightTransitionExecutorSchema,
  disposition: z.enum(["retire", "activate", "abort"]), decision_id: z.uuid(), decision_hash: Hash,
  core_receipt_id: Hash.nullable(), proof_hash: Hash.nullable(),
}).superRefine((value, context) => {
  if (value.disposition !== "abort" && (value.core_receipt_id === null || value.proof_hash === null)
    || value.disposition === "abort" && value.core_receipt_id !== null) {
    context.addIssue({ code: "custom", message: "committed outcome requires its exact Core decision and native proof" });
  }
});
export type HindsightTransitionOutcomeRequest = z.infer<typeof HindsightTransitionOutcomeRequestSchema>;
export const HindsightTransitionOutcomeSchema = z.strictObject({ request: HindsightTransitionOutcomeRequestSchema,
  bank_id: Id, provider_lineage: z.uuid(), bank_generation: z.uuid(), phase: z.enum(["retired", "active", "aborted", "quarantined"]),
  resolution: z.enum(["committed", "source_resumed", "retired_baseline_restored", "unused_baseline_held"]),
  restored_baseline_hash: Hash.nullable().default(null), recorded_at: Time, outcome_hash: Hash });
export type HindsightTransitionOutcome = z.infer<typeof HindsightTransitionOutcomeSchema>;
export const HindsightTransitionStatusSchema = z.strictObject({ protocol: Protocol, bank_id: Id,
  request: HindsightTransitionAcquireSchema, executor: HindsightTransitionExecutorSchema, revision: Revision,
  phase: z.enum(["draining", "fenced", "proven", "retired", "active", "aborted", "quarantined"]),
  lease_expires_at: Time, executor_live: z.boolean(), active_writers: Count, accepted_operations: Count,
  proof: HindsightTransitionProofSchema.nullable(), outcome: HindsightTransitionOutcomeSchema.nullable(),
});
export type HindsightTransitionStatus = z.infer<typeof HindsightTransitionStatusSchema>;
export const HindsightTransitionFailureSchema = z.strictObject({ error: z.literal("taki_transition_refused"), reason: z.enum([
  "unsupported_storage", "identity_mismatch", "request_conflict", "transition_not_found", "bank_not_found", "generation_mismatch",
  "bank_owned", "baseline_required", "baseline_mismatch", "executor_lost", "revision_conflict", "accepted_work_unresolved",
  "phase_conflict", "proof_required", "proof_mismatch", "decision_conflict", "evidence_corrupt", "invalid_request_hash",
  "invalid_delta", "descriptor_mismatch", "body_mismatch", "artifact_conflict", "unused_scope_unproven", "unused_scope_changed",
  "authentication_failed", "invalid_request", "bank_fenced", "writer_stale", "native_maintenance_incomplete", "staged_effects_require_recovery",
]) });
export type HindsightTransitionFailure = z.infer<typeof HindsightTransitionFailureSchema>;
export const HindsightTransitionAuxiliaryPageSchema = z.strictObject({ transition_id: z.uuid(), bank_id: Id, proof_hash: Hash,
  page_number: Count, total_pages: Revision, records: z.array(z.strictObject({ table: z.string(), row_json: z.string() })), page_hash: Hash });
export type HindsightTransitionAuxiliaryPage = z.infer<typeof HindsightTransitionAuxiliaryPageSchema>;
