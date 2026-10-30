/**
 * INPUT:  joint native/application snapshot, hydration and complete change-event descriptors
 * OUTPUT: closed paired-checkpoint read contracts and guarded reflection policy context
 * POS:    shared application-state read wire — native cursors, artifact revisions and state cursors stay independent
 */
import { z } from "zod";
import { MemoryBankScopeSchema } from "./memory-provider-domain-schema.ts";
import { HindsightNativeReflectRequestSchema, HindsightNativeReflectResponseSchema } from "./hindsight-native-runtime-schema.ts";
import { TakiApplicationArtifactSchema } from "./hindsight-application-artifact-schema.ts";
import { TakiApplicationNativeHeadSchema } from "./hindsight-application-native-schema.ts";
import {
  HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS, HINDSIGHT_APPLICATION_MAX_TTL_SECONDS,
  TakiApplicationIdSchema as Id, TakiApplicationHashSchema as Hash, TakiApplicationCountSchema as Count,
  TakiApplicationRevisionSchema as Revision, TakiApplicationTimeSchema as Time, TakiApplicationObjectKindSchema,
  TakiApplicationNamespaceSchema, TakiApplicationNativeVersionSchema, TakiApplicationArtifactKeySchema,
  TakiApplicationCheckpointSchema, TakiApplicationBodyRefSchema,
} from "./hindsight-application-primitives-schema.ts";

export const TakiApplicationSelectorSchema = z.strictObject({
  object_kind: TakiApplicationObjectKindSchema, object_id: Id, expected_version: TakiApplicationNativeVersionSchema.nullable().default(null),
});
export type TakiApplicationSelector = z.infer<typeof TakiApplicationSelectorSchema>;
export const TakiApplicationSelectorResultSchema = z.strictObject({
  kind: z.literal("selector"), selector: TakiApplicationSelectorSchema,
  status: z.enum(["bound", "binding_missing", "rebind_required", "gone", "stale", "not_applicable"]),
});
export const TakiApplicationRecordDescriptorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("native"), head: TakiApplicationNativeHeadSchema }),
  z.strictObject({ kind: z.literal("artifact"), artifact: TakiApplicationArtifactSchema }), TakiApplicationSelectorResultSchema,
]);
export type TakiApplicationRecordDescriptor = z.infer<typeof TakiApplicationRecordDescriptorSchema>;
export const TakiApplicationRecordPageSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, page_number: Count,
  records: z.array(TakiApplicationRecordDescriptorSchema), page_hash: Hash,
});
export type TakiApplicationRecordPage = z.infer<typeof TakiApplicationRecordPageSchema>;
export const TakiApplicationReadBundleManifestSchema = z.strictObject({
  contract_version: z.literal("1.0.0"), snapshot_id: z.uuid(), request_id: z.uuid(),
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, kind: z.enum(["snapshot", "hydrate"]),
  checkpoint: TakiApplicationCheckpointSchema, native_schema_version: z.literal(1), application_schema_version: z.literal(1),
  total_records: Count, total_pages: Count, pages_hash: Hash, manifest_hash: Hash, created_at: Time, expires_at: Time,
});
export type TakiApplicationReadBundleManifest = z.infer<typeof TakiApplicationReadBundleManifestSchema>;
export const TakiApplicationSnapshotRequestSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, request_id: z.uuid(),
  ttl_seconds: z.int().min(1).max(HINDSIGHT_APPLICATION_MAX_TTL_SECONDS).default(HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS),
});
export type TakiApplicationSnapshotRequest = z.infer<typeof TakiApplicationSnapshotRequestSchema>;
export const TakiApplicationHydrateRequestSchema = TakiApplicationSnapshotRequestSchema.extend({
  selectors: z.array(TakiApplicationSelectorSchema).max(256).default([]),
  artifact_keys: z.array(TakiApplicationArtifactKeySchema).max(256).default([]),
});
export type TakiApplicationHydrateRequest = z.infer<typeof TakiApplicationHydrateRequestSchema>;
export const TakiApplicationNativeBatchSchema = z.strictObject({
  batch_id: z.uuid(), first_cursor: Revision, last_cursor: Revision, size: Revision,
});
export const TakiApplicationStateChangeManifestSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, state_cursor: Revision,
  from_checkpoint: TakiApplicationCheckpointSchema, to_checkpoint: TakiApplicationCheckpointSchema,
  native_batches: z.array(TakiApplicationNativeBatchSchema), total_records: Count, total_pages: Count,
  pages_hash: Hash, event_hash: Hash, bank_deleted: z.boolean(), created_at: Time,
});
export type TakiApplicationStateChangeManifest = z.infer<typeof TakiApplicationStateChangeManifestSchema>;
export const TakiApplicationStateChangePageSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, from_checkpoint: TakiApplicationCheckpointSchema,
  to_checkpoint: TakiApplicationCheckpointSchema, changes: z.array(TakiApplicationStateChangeManifestSchema),
  has_more: z.boolean(), minimum_state_cursor: Count,
});
export type TakiApplicationStateChangePage = z.infer<typeof TakiApplicationStateChangePageSchema>;
export const TakiApplicationPruneRequestSchema = z.strictObject({ namespace: TakiApplicationNamespaceSchema, through_state_cursor: Count });
export const TakiApplicationReadContextSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, purpose: z.enum(["reflect", "maintenance"]),
  policy_contract_version: z.literal("1.0.0").default("1.0.0"), captured_at: Time, scope: MemoryBankScopeSchema,
  actor: z.enum(["user", "agent", "system"]), mood: z.string().nullable(),
});
export type TakiApplicationReadContext = z.infer<typeof TakiApplicationReadContextSchema>;
export const TakiApplicationReflectAdmissionSchema = z.strictObject({
  checkpoint: TakiApplicationCheckpointSchema, context_hash: Hash, admitted_memories: Count,
  withheld_inputs: z.array(z.enum(["bank_profile", "directives", "mental_models", "whole_sources", "entities"])),
  linearization: z.literal("before_each_model_submission"),
});
export type TakiApplicationReflectAdmission = z.infer<typeof TakiApplicationReflectAdmissionSchema>;
export const TakiApplicationReflectRequestSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, request_id: z.uuid(),
  policy_context_ref: TakiApplicationBodyRefSchema, native_request: HindsightNativeReflectRequestSchema,
});
export type TakiApplicationReflectRequest = z.infer<typeof TakiApplicationReflectRequestSchema>;
export const TakiApplicationReflectResponseSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: Id, request_id: z.uuid(),
  admission: TakiApplicationReflectAdmissionSchema, native_response: HindsightNativeReflectResponseSchema,
});
export type TakiApplicationReflectResponse = z.infer<typeof TakiApplicationReflectResponseSchema>;
