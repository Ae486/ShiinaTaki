/**
 * INPUT:  provider-neutral canonical memory payloads crossing Shared/Core boundaries
 * OUTPUT: strict schemas and inferred types for authority, banks, sources, units, policy, and capabilities
 * POS:    shared contract — Hindsight-aligned logical model without provider-private persistence details
 */
import { z } from "zod";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string().max(16_384), z.number().finite(), z.boolean(), z.null(),
  z.array(JsonValueSchema).max(256),
  z.record(z.string().min(1).max(128), JsonValueSchema).refine((value) => Object.keys(value).length <= 256),
]));
const JsonObjectSchema = z.record(z.string().min(1).max(128), JsonValueSchema)
  .refine((value) => Object.keys(value).length <= 256);

export const MemoryAuthorityEpochSchema = z.strictObject({
  epochId: Id, providerId: Id, providerLineageId: Id, mode: z.literal("authority"),
  status: z.enum(["active", "closed"]), predecessorEpochId: Id.nullable(), startedAt: Timestamp,
  endedAt: Timestamp.nullable(), reason: z.enum(["initial-local", "planned-switch", "emergency-takeover"]),
}).superRefine((v, ctx) => {
  if (v.status === "active" && v.endedAt !== null) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "active epoch cannot end" });
  if (v.status === "closed" && v.endedAt === null) ctx.addIssue({ code: "custom", path: ["endedAt"], message: "closed epoch must end" });
});
export type MemoryAuthorityEpoch = z.infer<typeof MemoryAuthorityEpochSchema>;

export const MemoryBankScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("global"), characterId: z.null() }),
  z.strictObject({ kind: z.literal("character"), characterId: Id }),
]);
export type MemoryBankScope = z.infer<typeof MemoryBankScopeSchema>;
const DispositionSchema = z.strictObject({ skepticism: z.int().min(1).max(5), literalism: z.int().min(1).max(5), empathy: z.int().min(1).max(5) });
export const CanonicalMemoryBankSchema = z.strictObject({
  authorityEpochId: Id, bankId: Id, scope: MemoryBankScopeSchema, name: z.string().min(1).max(256),
  disposition: DispositionSchema, mission: z.string().max(16_384), config: JsonObjectSchema,
  revision: z.int().min(1), createdAt: Timestamp, updatedAt: Timestamp,
});
export type CanonicalMemoryBank = z.infer<typeof CanonicalMemoryBankSchema>;

export const MemoryProvenanceSchema = z.strictObject({
  actor: z.enum(["user", "agent", "system", "provider"]),
  origin: z.enum(["explicit-user", "explicit-agent", "auto-gate", "machine-observed", "legacy-import", "provider-derived"]),
  characterId: Id.nullable(), timelineFromSeq: z.int().min(0).nullable(), timelineToSeq: z.int().min(0).nullable(),
  capturedAt: Timestamp, sanitized: z.literal(true), sourceRef: z.string().max(512).nullable(),
}).superRefine((value, context) => {
  const bounds = [value.timelineFromSeq, value.timelineToSeq];
  if (bounds.filter((item) => item === null).length === 1) {
    context.addIssue({ code: "custom", path: ["timelineFromSeq"], message: "timeline bounds must both be set or null" });
  } else if (value.timelineFromSeq !== null && value.timelineToSeq !== null && value.timelineFromSeq > value.timelineToSeq) {
    context.addIssue({ code: "custom", path: ["timelineToSeq"], message: "timeline range is reversed" });
  }
});
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;

const ObservationScopesSchema = z.union([z.literal("shared"), z.array(z.array(Id).min(1).max(64)).max(64)]).nullable();
const TagsSchema = z.array(z.string().min(1).max(128)).max(128);
const MetadataSchema = JsonObjectSchema;
export const CanonicalMemorySourceSchema = z.strictObject({
  authorityEpochId: Id, bankId: Id, documentId: Id, contentHash: z.string().max(256).nullable(),
  retainedText: z.string().max(100_000).nullable(), context: z.string().max(16_384).nullable(), tags: TagsSchema,
  metadata: MetadataSchema, observationScopes: ObservationScopesSchema, provenance: MemoryProvenanceSchema,
  revision: z.int().min(1), createdAt: Timestamp, updatedAt: Timestamp,
});
export type CanonicalMemorySource = z.infer<typeof CanonicalMemorySourceSchema>;

export const CanonicalMemoryUnitSchema = z.strictObject({
  authorityEpochId: Id, bankId: Id, memoryId: Id, documentId: Id.nullable(), chunkId: Id.nullable(),
  text: z.string().min(1).max(100_000), context: z.string().max(16_384).nullable(),
  factType: z.enum(["world", "experience", "observation"]), state: z.enum(["valid", "invalidated"]),
  revision: z.int().min(1), tags: TagsSchema, metadata: MetadataSchema, entities: z.array(Id).max(128),
  sourceMemoryIds: z.array(Id).max(128), observationScopes: ObservationScopesSchema,
  eventDate: Timestamp.nullable(), occurredStart: Timestamp.nullable(), occurredEnd: Timestamp.nullable(), mentionedAt: Timestamp.nullable(),
  createdAt: Timestamp, updatedAt: Timestamp, editedAt: Timestamp.nullable(), consolidatedAt: Timestamp.nullable(),
  consolidationFailedAt: Timestamp.nullable(), invalidationReason: z.string().max(512).nullable(), invalidatedAt: Timestamp.nullable(),
  proofCount: z.int().min(1),
}).superRefine((v, ctx) => {
  if (v.state === "valid" && (v.invalidatedAt !== null || v.invalidationReason !== null)) ctx.addIssue({ code: "custom", path: ["state"], message: "valid unit cannot carry invalidation" });
  if (v.state === "invalidated" && v.invalidatedAt === null) ctx.addIssue({ code: "custom", path: ["invalidatedAt"], message: "invalidated unit needs timestamp" });
  if (v.memoryId !== undefined && v.sourceMemoryIds.includes(v.memoryId)) ctx.addIssue({ code: "custom", path: ["sourceMemoryIds"], message: "lineage self-edge" });
});
export type CanonicalMemoryUnit = z.infer<typeof CanonicalMemoryUnitSchema>;

const MentalModelSchema = z.strictObject({ kind: z.literal("mental_model"), bankId: Id, mentalModelId: Id, subtype: Id, name: z.string().min(1).max(256), sourceQuery: z.string().max(16_384).nullable(), content: z.string().max(100_000).nullable(), tags: TagsSchema, maxTokens: z.int().positive().max(1_000_000).nullable(), trigger: JsonObjectSchema.nullable(), lastRefreshedAt: Timestamp.nullable(), createdAt: Timestamp, reflectResponse: JsonObjectSchema.nullable(), structuredContent: JsonObjectSchema.nullable() });
const DirectiveSchema = z.strictObject({ kind: z.literal("directive"), bankId: Id, directiveId: Id, name: z.string().min(1).max(256), content: z.string().min(1).max(100_000), priority: z.int().min(0).max(100), isActive: z.boolean(), tags: TagsSchema, createdAt: Timestamp, updatedAt: Timestamp });
export const CanonicalDerivedPayloadSchema = z.discriminatedUnion("kind", [MentalModelSchema, DirectiveSchema]);
export type CanonicalDerivedPayload = z.infer<typeof CanonicalDerivedPayloadSchema>;
export const CanonicalDerivedMemorySchema = z.strictObject({ authorityEpochId: Id, bankId: Id, objectRevision: z.int().min(1), payload: CanonicalDerivedPayloadSchema })
  .superRefine((value, context) => {
    if (value.bankId !== value.payload.bankId) context.addIssue({ code: "custom", path: ["payload", "bankId"], message: "derived Bank identity mismatch" });
  });
export type CanonicalDerivedMemory = z.infer<typeof CanonicalDerivedMemorySchema>;

const RetentionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("permanent") }),
  z.strictObject({ kind: z.literal("rolling-window"), days: z.int().positive() }),
  z.strictObject({ kind: z.literal("expiring"), expiresAt: Timestamp }),
  z.strictObject({ kind: z.literal("importance-decay"), archiveBelowImportance: z.int().min(1).max(10), afterDays: z.int().positive() }),
]);
export const TakiMemoryPolicyProjectionSchema = z.strictObject({
  authorityEpochId: Id, bankId: Id, memoryId: Id, layerId: Id, importance: z.int().min(1).max(10),
  visibility: z.enum(["pinned", "retrieved", "mood-gated", "hidden"]), disclosure: z.string().max(512).nullable(),
  origin: z.enum(["self", "observed"]), emotionalWeight: z.number().finite().nullable(), retention: RetentionSchema,
  policyVersion: z.int().min(1), updatedAt: Timestamp,
});
export type TakiMemoryPolicyProjection = z.infer<typeof TakiMemoryPolicyProjectionSchema>;
export const CanonicalMemoryRecordSchema = z.strictObject({ unit: CanonicalMemoryUnitSchema, policy: TakiMemoryPolicyProjectionSchema, provenance: MemoryProvenanceSchema })
  .superRefine((value, context) => {
    const unit = value.unit; const policy = value.policy;
    if (unit.authorityEpochId !== policy.authorityEpochId) context.addIssue({ code: "custom", path: ["policy", "authorityEpochId"], message: "record epoch identity mismatch" });
    if (unit.bankId !== policy.bankId) context.addIssue({ code: "custom", path: ["policy", "bankId"], message: "record Bank identity mismatch" });
    if (unit.memoryId !== policy.memoryId) context.addIssue({ code: "custom", path: ["policy", "memoryId"], message: "record memory identity mismatch" });
    const layerTags = unit.tags.filter((tag) => tag.startsWith("taki-layer:"));
    if (layerTags.length !== 1 || layerTags[0] !== `taki-layer:${policy.layerId}`) {
      context.addIssue({ code: "custom", path: ["unit", "tags"], message: "record requires exactly one matching Taki layer tag" });
    }
  });
export type CanonicalMemoryRecord = z.infer<typeof CanonicalMemoryRecordSchema>;

export const MemoryProviderCapabilitiesSchema = z.strictObject({
  providerId: Id, contractVersion: z.literal(1), retain: z.boolean(), recall: z.boolean(), reflect: z.boolean(),
  edit: z.boolean(), invalidate: z.boolean(), restore: z.boolean(), conditionalMutation: z.boolean(), idempotentWrites: z.boolean(),
  sparseRetrieval: z.boolean(), vectorRetrieval: z.enum(["unavailable", "building", "ready", "degraded"]), derivedMemoryRead: z.boolean(),
});
export type MemoryProviderCapabilities = z.infer<typeof MemoryProviderCapabilitiesSchema>;

export const MemoryErrorCodeSchema = z.enum(["MEMORY_INVALID_REQUEST", "MEMORY_NOT_FOUND", "MEMORY_REQUEST_ID_CONFLICT", "MEMORY_REVISION_MISMATCH", "MEMORY_CAPABILITY_UNSUPPORTED", "MEMORY_AUTHORITY_MISMATCH", "MEMORY_OPERATION_CANCELLED", "MEMORY_PROVIDER_UNAVAILABLE", "MEMORY_INTEGRITY_ERROR", "MEMORY_INTERNAL_ERROR"]);
export type MemoryErrorCode = z.infer<typeof MemoryErrorCodeSchema>;
const ErrorCategorySchema = z.enum(["validation", "not-found", "conflict", "capability", "authority", "availability", "integrity", "internal"]);
const ErrorNextActionSchema = z.enum(["fix-request", "refresh-memory", "retry", "check-provider", "none"]);
export const MEMORY_ERROR_POLICY = {
  MEMORY_INVALID_REQUEST: ["validation", false, "fix-request"],
  MEMORY_NOT_FOUND: ["not-found", false, "refresh-memory"],
  MEMORY_REQUEST_ID_CONFLICT: ["conflict", false, "fix-request"],
  MEMORY_REVISION_MISMATCH: ["conflict", false, "refresh-memory"],
  MEMORY_CAPABILITY_UNSUPPORTED: ["capability", false, "none"],
  MEMORY_AUTHORITY_MISMATCH: ["authority", false, "check-provider"],
  MEMORY_OPERATION_CANCELLED: ["availability", false, "none"],
  MEMORY_PROVIDER_UNAVAILABLE: ["availability", true, "check-provider"],
  MEMORY_INTEGRITY_ERROR: ["integrity", false, "check-provider"],
  MEMORY_INTERNAL_ERROR: ["internal", false, "check-provider"],
} as const;
export const MemoryErrorSchema = z.strictObject({ code: MemoryErrorCodeSchema, category: ErrorCategorySchema, message: z.string().min(1).max(512), retryable: z.boolean(), nextAction: ErrorNextActionSchema, currentRevision: z.int().min(1).optional() })
  .superRefine((value, context) => {
    const [category, retryable, nextAction] = MEMORY_ERROR_POLICY[value.code];
    if (value.category !== category) context.addIssue({ code: "custom", path: ["category"], message: "error category contradicts code" });
    if (value.retryable !== retryable) context.addIssue({ code: "custom", path: ["retryable"], message: "error retryability contradicts code" });
    if (value.nextAction !== nextAction) context.addIssue({ code: "custom", path: ["nextAction"], message: "error next action contradicts code" });
    if (value.code === "MEMORY_REVISION_MISMATCH" && value.currentRevision === undefined) context.addIssue({ code: "custom", path: ["currentRevision"], message: "revision mismatch requires current revision" });
    if (value.code !== "MEMORY_REVISION_MISMATCH" && value.currentRevision !== undefined) context.addIssue({ code: "custom", path: ["currentRevision"], message: "current revision only applies to revision mismatch" });
  });
export type MemoryError = z.infer<typeof MemoryErrorSchema>;
