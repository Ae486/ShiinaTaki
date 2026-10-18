/**
 * INPUT:  optional Native API-engine observations and operator scope selectors
 * OUTPUT: strict bounded wire and Core-owned short-lived configuration read models
 * POS:    shared/protocol — partial model aliases only; never setup or deployment attestation
 */
import { z } from "zod";
import { HindsightModelProjectionSchema } from "./hindsight-connection-schema.ts";

export const HINDSIGHT_CONFIGURATION_BUILD = "taki-memory-hindsight-0.9.0-config-observation-v1";
export const HINDSIGHT_CONFIGURATION_VERSION = "1.0.0";
export const HINDSIGHT_CONFIGURATION_MAX_BYTES = 16 * 1024;
export const HINDSIGHT_CONFIGURATION_TTL_MS = 60_000;
export const HINDSIGHT_CONFIGURATION_METHODS = {
  observe: "memory.hindsight.configuration.observe",
  status: "memory.hindsight.configuration.status",
} as const;

export const HindsightObservedModelIdentifierSchema = z.string().min(1).max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,239}$/)
  .refine((value) => !value.includes("://") && !/^[A-Za-z]:/.test(value), "Unsafe model identifier");
export const HindsightObservedProfileSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("single"), provider: z.enum([
    "openai", "openai-responses", "groq", "ollama", "ollama-cloud", "gemini", "anthropic", "lmstudio",
    "llamacpp", "vertexai", "openai-codex", "claude-code", "mock", "minimax", "deepseek", "litellm",
    "bedrock", "volcano", "openrouter", "requesty", "zai", "opencode-go", "atlas", "fireworks", "nous",
  ]), configuredModel: HindsightObservedModelIdentifierSchema }),
  z.strictObject({ kind: z.literal("disabled") }),
  z.strictObject({ kind: z.literal("unknown"), reason: z.enum([
    "routed_profile", "unsupported_provider", "unsafe_identifier", "unavailable",
  ]) }),
]);
export type HindsightObservedProfile = z.infer<typeof HindsightObservedProfileSchema>;
const uncovered = z.strictObject({ kind: z.literal("unknown"), reason: z.literal("not_covered") });

export const HindsightConfigurationObservationSchema = z.strictObject({
  version: z.literal(HINDSIGHT_CONFIGURATION_VERSION),
  nonce: z.uuid(),
  observedAt: z.iso.datetime({ offset: true }).refine((value) => /(?:Z|\+00:00)$/.test(value)),
  source: z.strictObject({ upstreamCommit: z.string().regex(/^[a-f0-9]{40}$/), compatibilityBuild: z.string().min(1).max(128) }),
  target: z.strictObject({ providerLineage: z.uuid(), bankId: z.string().min(1).max(240), bankGeneration: z.uuid() }),
  runtimeSessionId: z.uuid(),
  executionCoverage: z.literal("api_runtime_only"),
  profiles: z.strictObject({ default: HindsightObservedProfileSchema, retain: HindsightObservedProfileSchema,
    reflect: HindsightObservedProfileSchema, consolidation: HindsightObservedProfileSchema }),
  embedding: uncovered,
  reranker: uncovered,
  workerConfiguration: z.literal("unknown"),
});
export type HindsightConfigurationObservation = z.infer<typeof HindsightConfigurationObservationSchema>;
export const HindsightConfigurationRefusalSchema = z.strictObject({
  error: z.literal("taki_configuration_observation_refused"),
  reason: z.enum(["not_authorized", "unavailable", "invalid_request"]),
});
export type HindsightConfigurationRefusal = z.infer<typeof HindsightConfigurationRefusalSchema>;

export const HindsightConfigurationScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("global") }),
  z.strictObject({ kind: z.literal("character"), characterId: z.string().min(1).max(160) }),
]);
export type HindsightConfigurationScope = z.infer<typeof HindsightConfigurationScopeSchema>;
export const HindsightConfigurationParamsSchema = z.strictObject({ scope: HindsightConfigurationScopeSchema });
export type HindsightConfigurationParams = z.infer<typeof HindsightConfigurationParamsSchema>;
const comparison = z.enum(["match", "mismatch", "not_requested", "unknown"]);
export const HindsightConfigurationComparisonSchema = z.strictObject({
  defaultProvider: comparison, defaultModel: comparison, retainModel: comparison, reflectModel: comparison,
  consolidationModel: comparison, embeddingProvider: comparison, embeddingModel: comparison,
  rerankerProvider: comparison, rerankerModel: comparison,
});
export type HindsightConfigurationComparison = z.infer<typeof HindsightConfigurationComparisonSchema>;
export const HindsightConfigurationStatusSchema = z.strictObject({
  scope: HindsightConfigurationScopeSchema,
  status: z.enum(["not_observed", "observed", "unsupported", "not_authorized", "unavailable", "stale", "identity_mismatch"]),
  reason: z.enum(["not_observed", "observed", "capability_missing", "not_authorized", "connection_unavailable",
    "request_failed", "invalid_response", "identity_mismatch", "context_changed", "expired", "runtime_changed"]),
  bankId: z.string().min(1).max(240).nullable(),
  desired: HindsightModelProjectionSchema.nullable(),
  observation: HindsightConfigurationObservationSchema.nullable(),
  comparison: HindsightConfigurationComparisonSchema,
  identity: z.enum(["pinned", "unpinned"]),
  observationId: z.uuid().nullable(),
  receivedAt: z.iso.datetime({ offset: true }).nullable(),
  validForMs: z.int().min(0).max(HINDSIGHT_CONFIGURATION_TTL_MS),
}).superRefine((value, ctx) => {
  if ((value.status === "observed") !== (value.observation !== null)
    || (value.status !== "observed" && Object.values(value.comparison).some((item) => item === "match" || item === "mismatch"))) {
    ctx.addIssue({ code: "custom", message: "Only current observations can expose models or comparisons" });
  }
});
export type HindsightConfigurationStatus = z.infer<typeof HindsightConfigurationStatusSchema>;
