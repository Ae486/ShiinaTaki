/**
 * INPUT:  independently versioned D77 namespace, native versions and immutable artifact/body references
 * OUTPUT: closed wire primitives matching the native TakiApplication models
 * POS:    shared application-state contract — native and application clocks never share a revision domain
 */
import { z } from "zod";

export const HINDSIGHT_APPLICATION_STATE_VERSION = "1.0.0" as const;
export const HINDSIGHT_APPLICATION_STATE_BUILD = "taki-memory-hindsight-0.9.0-d77-v1" as const;
export const HINDSIGHT_APPLICATION_PART_BYTES = 262_144;
export const HINDSIGHT_APPLICATION_RESPONSE_BYTES = 524_288;
export const HINDSIGHT_APPLICATION_UPLOAD_BYTES = 16_777_216;
export const HINDSIGHT_APPLICATION_DEFAULT_TTL_SECONDS = 3600;
export const HINDSIGHT_APPLICATION_MAX_TTL_SECONDS = 86_400;

export const TakiApplicationIdSchema = z.string().min(1).max(256);
export const TakiApplicationHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const TakiApplicationCountSchema = z.int().min(0);
export const TakiApplicationRevisionSchema = z.int().min(1);
export const TakiApplicationTimeSchema = z.iso.datetime({ offset: true });
export const TakiApplicationObjectKindSchema = z.enum(["bank", "document", "memory_unit", "mental_model", "directive"]);
export const TakiApplicationArtifactKindSchema = z.enum(["bank", "source", "memory", "block"]);
export const TakiApplicationBodySchemaSchema = z.enum([
  "application-bank.v1", "application-source.v1", "application-memory.v1", "application-block.v1",
  "application-commands.v1", "application-read-context.v1", "application-native-record.v1",
  "application-native-source.v1", "application-record-page.v1", "application-affected-versions.v1",
]);
export type TakiApplicationBodySchema = z.infer<typeof TakiApplicationBodySchemaSchema>;

export const TakiApplicationFailureCodeSchema = z.enum([
  "invalid_request", "authentication_failed", "capability_unsupported", "bank_not_found", "namespace_mismatch", "bank_deleted",
  "body_not_found", "body_conflict", "body_incomplete", "body_not_sealed", "body_integrity_error",
  "payload_too_large", "unsupported_body_schema", "request_id_conflict", "artifact_conflict",
  "native_version_conflict", "binding_invalid", "source_reference_invalid", "capture_required",
  "capture_gap", "state_reset_required", "snapshot_not_found", "snapshot_expired", "page_not_found",
  "policy_context_invalid", "policy_drift", "application_state_corrupt",
]);
export type TakiApplicationFailureCode = z.infer<typeof TakiApplicationFailureCodeSchema>;

export const TakiApplicationNamespaceSchema = z.strictObject({
  provider_lineage: z.uuid(), bank_generation: z.uuid(), application_id: z.literal("taki").default("taki"),
});
export type TakiApplicationNamespace = z.infer<typeof TakiApplicationNamespaceSchema>;
export const TakiApplicationNativeVersionSchema = z.strictObject({
  object_kind: TakiApplicationObjectKindSchema, object_id: TakiApplicationIdSchema,
  object_revision: TakiApplicationRevisionSchema, payload_hash: TakiApplicationHashSchema,
  native_cursor: TakiApplicationCountSchema.nullable(),
});
export type TakiApplicationNativeVersion = z.infer<typeof TakiApplicationNativeVersionSchema>;
export const TakiApplicationNativeTombstoneSchema = z.strictObject({
  object_kind: TakiApplicationObjectKindSchema, object_id: TakiApplicationIdSchema,
  object_revision: TakiApplicationRevisionSchema, last_payload_hash: TakiApplicationHashSchema.nullable(),
  native_cursor: TakiApplicationCountSchema,
});
export type TakiApplicationNativeTombstone = z.infer<typeof TakiApplicationNativeTombstoneSchema>;
export const TakiApplicationArtifactKeySchema = z.strictObject({
  artifact_kind: TakiApplicationArtifactKindSchema, artifact_id: TakiApplicationIdSchema,
});
export type TakiApplicationArtifactKey = z.infer<typeof TakiApplicationArtifactKeySchema>;
export const TakiApplicationArtifactVersionSchema = z.strictObject({
  key: TakiApplicationArtifactKeySchema, revision: TakiApplicationRevisionSchema, record_hash: TakiApplicationHashSchema,
});
export type TakiApplicationArtifactVersion = z.infer<typeof TakiApplicationArtifactVersionSchema>;
export const TakiApplicationCheckpointSchema = z.strictObject({
  native_cursor: TakiApplicationCountSchema, state_cursor: TakiApplicationCountSchema,
});
export type TakiApplicationCheckpoint = z.infer<typeof TakiApplicationCheckpointSchema>;
export const TakiApplicationBodyRefSchema = z.strictObject({
  body_id: z.uuid(), body_schema: TakiApplicationBodySchemaSchema, payload_hash: TakiApplicationHashSchema,
  bytes_sha256: TakiApplicationHashSchema, total_bytes: TakiApplicationRevisionSchema,
  part_bytes: z.literal(HINDSIGHT_APPLICATION_PART_BYTES).default(HINDSIGHT_APPLICATION_PART_BYTES),
  total_parts: TakiApplicationRevisionSchema,
}).refine((body) => body.total_parts === Math.ceil(body.total_bytes / body.part_bytes),
  "body part count must describe every byte");
export type TakiApplicationBodyRef = z.infer<typeof TakiApplicationBodyRefSchema>;

export const TakiApplicationNamespaceRequestSchema = z.strictObject({ namespace: TakiApplicationNamespaceSchema });
export const TakiApplicationInitializeResponseSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bank_id: TakiApplicationIdSchema,
  checkpoint: TakiApplicationCheckpointSchema, minimum_state_cursor: TakiApplicationCountSchema,
  initialized_at: TakiApplicationTimeSchema,
});
export type TakiApplicationInitializeResponse = z.infer<typeof TakiApplicationInitializeResponseSchema>;
