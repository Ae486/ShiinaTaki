/**
 * INPUT:  operator-provided Hindsight connection and compatibility projections
 * OUTPUT: bounded zod contracts for the exact Hindsight 0.9.0 setup boundary
 * POS:    shared/protocol — provider-neutral data only; secret values never belong here
 */
import { z } from "zod";

export const HINDSIGHT_API_VERSION = "0.9.0" as const;
export const HINDSIGHT_COMPATIBILITY_VERSION = "1.0.0" as const;
export const HINDSIGHT_COMPATIBILITY_BUILD = "taki-memory-hindsight-0.9.0-batch0-v2" as const;

export const HindsightDeploymentModeSchema = z.enum(["existing-instance", "managed-helper"]);
export type HindsightDeploymentMode = z.infer<typeof HindsightDeploymentModeSchema>;

const boundedText = z.string().min(1).max(240);
const nullableText = boundedText.nullable();
const timeout = z.number().int().min(250).max(120_000);
const endpoint = z.string().min(8).max(2048).url().refine((value) => {
  const parsed = new URL(value);
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
}, "endpoint must be an http(s) URL without credentials, query, or fragment");

export const HindsightModelProjectionSchema = z.strictObject({
  defaultProvider: nullableText,
  defaultModel: nullableText,
  retainModel: nullableText,
  reflectModel: nullableText,
  consolidationModel: nullableText,
  embeddingProvider: nullableText,
  embeddingModel: nullableText,
  rerankerProvider: nullableText,
  rerankerModel: nullableText,
});
export type HindsightModelProjection = z.infer<typeof HindsightModelProjectionSchema>;

export const HindsightConnectionProjectionSchema = z.strictObject({
  enabled: z.boolean(),
  deploymentMode: HindsightDeploymentModeSchema,
  endpoint,
  apiKeySecretRef: boundedText.regex(/^[a-z][a-z0-9-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)+$/),
  requestTimeoutMs: timeout,
  setupTimeoutMs: timeout,
  desiredTemplateRevision: boundedText.max(80),
  model: HindsightModelProjectionSchema,
});
export type HindsightConnectionProjection = z.infer<typeof HindsightConnectionProjectionSchema>;

export const HindsightSupportSchema = z.enum(["supported", "unsupported"]);
export const HindsightSupportReasonSchema = z.enum([
  "all_contracts_available", "backend_unavailable", "database_dialect_unsupported", "backend_capability_missing",
  "backend_capability_probe_failed", "alternative_memory_store", "memory_store_capability_missing",
  "memory_store_capability_probe_failed", "provider_lineage_unavailable", "authentication_not_required",
  "authentication_capability_probe_failed",
  "native_result_schema_unavailable",
  "current_state_transfer_schema_unavailable", "cutover_verification_schema_unavailable",
  "application_state_schema_unavailable", "application_reflect_unavailable",
]);
export const HindsightCompatibilitySupportSchema = z.strictObject({ state: HindsightSupportSchema, reason: HindsightSupportReasonSchema });
export type HindsightCompatibilitySupport = z.infer<typeof HindsightCompatibilitySupportSchema>;

export const HindsightVersionedContractSchema = z.strictObject({
  version: boundedText.max(40),
  support: HindsightCompatibilitySupportSchema,
});
export const HindsightApplicationStateContractSchema = HindsightVersionedContractSchema.extend({
  body_part_bytes: z.int().positive(), max_response_bytes: z.int().positive(), max_preparation_bytes: z.int().positive(),
  state_cursor_reset_supported: z.boolean(), capture_mode: z.literal("explicit_generation_initialization"),
});
export const HindsightApplicationReflectContractSchema = HindsightVersionedContractSchema.extend({
  policy_context_schema: z.literal("application-read-context.v1"),
  withheld_inputs: z.array(z.enum(["bank_profile", "directives", "mental_models", "whole_sources", "entities"])),
  linearization: z.literal("before_each_model_submission"),
});
export const HindsightCompatibilityProjectionSchema = z.strictObject({
  baseApiVersion: boundedText.max(40),
  compatibilityVersion: boundedText.max(40),
  compatibilityBuild: boundedText.max(120),
  providerLineage: z.string().uuid().nullable(),
  databaseDialect: z.enum(["postgresql", "oracle", "unknown"]),
  storageMode: z.enum(["sql_rows", "alternative_store", "unknown"]),
  support: HindsightCompatibilitySupportSchema,
  journalVersion: z.number().int().nonnegative().max(100),
  snapshotVersion: z.number().int().nonnegative().max(100),
  contracts: z.strictObject({
    changeJournal: HindsightVersionedContractSchema,
    conditionalMutation: HindsightVersionedContractSchema,
    logicalSnapshot: HindsightVersionedContractSchema,
    additiveObservationInstructions: HindsightVersionedContractSchema,
    controlledLayerProjection: HindsightVersionedContractSchema,
    nativeResults: HindsightVersionedContractSchema.optional(),
    currentStateTransfer: HindsightVersionedContractSchema.optional(),
    cutoverVerification: HindsightVersionedContractSchema.optional(),
    applicationState: HindsightVersionedContractSchema.optional(),
    applicationReflect: HindsightVersionedContractSchema.optional(),
  }),
});
export type HindsightCompatibilityProjection = z.infer<typeof HindsightCompatibilityProjectionSchema>;

export const HINDSIGHT_ERROR_CODES = [
  "HINDSIGHT_SECRET_UNAVAILABLE", "HINDSIGHT_ENDPOINT_REJECTED", "HINDSIGHT_UNREACHABLE", "HINDSIGHT_TIMEOUT",
  "HINDSIGHT_CANCELLED", "HINDSIGHT_AUTHENTICATION_FAILED", "HINDSIGHT_HEALTH_FAILED", "HINDSIGHT_VERSION_UNSUPPORTED",
  "HINDSIGHT_EXTENSION_UNSUPPORTED", "HINDSIGHT_DATABASE_UNSUPPORTED", "HINDSIGHT_TEMPLATE_INVALID",
  "HINDSIGHT_TEMPLATE_CONFLICT", "HINDSIGHT_LLM_HEALTH_UNAVAILABLE", "HINDSIGHT_STATE_CONFLICT", "HINDSIGHT_RESPONSE_INVALID",
  "HINDSIGHT_SNAPSHOT_EXPIRED", "HINDSIGHT_SNAPSHOT_NOT_FOUND", "HINDSIGHT_SNAPSHOT_PAGE_MISSING",
  "HINDSIGHT_CURSOR_RESET_REQUIRED", "HINDSIGHT_SNAPSHOT_INTEGRITY",
  "HINDSIGHT_OPERATION_IDENTITY_CONFLICT", "HINDSIGHT_SETUP_INTERRUPTED",
] as const;
export const HindsightErrorCodeSchema = z.enum(HINDSIGHT_ERROR_CODES);
export type HindsightErrorCode = z.infer<typeof HindsightErrorCodeSchema>;

export const HindsightSetupErrorSchema = z.strictObject({
  code: HindsightErrorCodeSchema,
  retryable: z.boolean(),
  nextAction: boundedText.max(240),
});
export type HindsightSetupError = z.infer<typeof HindsightSetupErrorSchema>;

export const HindsightBankSetupProjectionSchema = z.strictObject({
  scope: z.enum(["global", "character"]),
  canonicalIdentity: boundedText.max(240),
  externalBankId: boundedText.max(120),
  templateRevision: boundedText.max(80),
  templateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["pending", "dry-run-ok", "applied", "verified", "failed"]),
  operationIds: z.array(boundedText.max(120)).max(32),
  lastVerifiedAt: z.iso.datetime({ offset: true }).nullable(),
  lastError: HindsightSetupErrorSchema.nullable(),
});
export type HindsightBankSetupProjection = z.infer<typeof HindsightBankSetupProjectionSchema>;

export const HindsightLlmOperationHealthSchema = z.strictObject({
  operation: z.enum(["retain", "consolidation", "reflect"]),
  ok: z.boolean(),
  status: z.enum(["connected", "not_configured", "auth_failed", "unreachable", "timeout"]),
  latencyMs: z.number().int().nonnegative().max(120_000).nullable(),
});
export const HindsightBankLlmHealthProjectionSchema = z.strictObject({
  bankId: boundedText.max(120),
  operations: z.array(HindsightLlmOperationHealthSchema).max(3),
});
export type HindsightBankLlmHealthProjection = z.infer<typeof HindsightBankLlmHealthProjectionSchema>;
