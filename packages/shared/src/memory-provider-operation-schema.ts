/**
 * INPUT:  model/provider operation payloads for the canonical memory contract
 * OUTPUT: strict retain, recall, reflect, and mutation request/result schemas
 * POS:    shared contract — provider-neutral operation families; runtime identity stays out of tool inputs
 */
import { z } from "zod";
import { CanonicalMemoryRecordSchema, JsonValueSchema, MEMORY_ERROR_POLICY, MemoryErrorCodeSchema, MemoryProvenanceSchema, TakiMemoryPolicyProjectionSchema } from "./memory-provider-domain-schema.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });
const ScopeSchema = z.union([z.literal("shared"), z.array(z.array(Id).min(1).max(64)).max(64)]).nullable();
const Tags = z.array(z.string().min(1).max(128)).max(128);
const Metadata = z.record(z.string().min(1).max(128), JsonValueSchema).refine((v) => Object.keys(v).length <= 256);
const PolicyInput = TakiMemoryPolicyProjectionSchema.omit({ authorityEpochId: true, bankId: true, memoryId: true, updatedAt: true });

export const RetainRequestSchema = z.strictObject({
  bankId: Id, content: z.string().min(1).max(100_000), context: z.string().max(16_384).nullable(),
  timestamp: z.union([Timestamp, z.literal("unset")]).nullable(), tags: Tags, entities: z.array(Id).max(128), metadata: Metadata,
  observationScopes: ScopeSchema, documentId: Id.nullable(), strategy: Id.nullable(), updateMode: z.enum(["replace", "append"]),
  provenance: MemoryProvenanceSchema, policy: PolicyInput,
});
export type RetainRequest = z.infer<typeof RetainRequestSchema>;
export const RetainResultSchema = z.strictObject({ status: z.literal("completed"), documentId: Id, sourceRevision: z.int().min(1), memories: z.array(z.strictObject({ memoryId: Id, revision: z.int().min(1) })).min(1).max(256) });
export type RetainResult = z.infer<typeof RetainResultSchema>;

export const RecallRequestSchema = z.strictObject({
  bankId: Id, query: z.string().min(1).max(16_384), queryTimestamp: Timestamp.nullable(), budget: z.enum(["low", "mid", "high"]),
  limit: z.int().min(1).max(100), maxTokens: z.int().min(1).max(32_000), factTypes: z.array(z.enum(["world", "experience", "observation"])).min(1).max(3),
  layerIds: z.array(Id).max(64), includeInvalidated: z.literal(false),
});
export type RecallRequest = z.infer<typeof RecallRequestSchema>;
export const RecallScoreSchema = z.strictObject({ source: z.enum(["sparse", "vector", "hybrid", "provider"]), value: z.number().finite(), higherIsBetter: z.boolean() });
export const RecallHitSchema = z.strictObject({ record: CanonicalMemoryRecordSchema, scores: z.array(RecallScoreSchema).max(8), confirmed: z.boolean() });
export const RecallResultSchema = z.strictObject({ hits: z.array(RecallHitSchema).max(100), returned: z.int().min(0).max(100), truncated: z.boolean(), vectorState: z.enum(["unavailable", "building", "ready", "degraded"]), partial: z.boolean(), branchFailures: z.array(z.strictObject({ scope: z.enum(["global", "character"]), code: MemoryErrorCodeSchema, retryable: z.boolean(), nextAction: z.enum(["fix-request", "refresh-memory", "retry", "check-provider", "none"]) })).max(2) }).superRefine((value, context) => {
  if (value.returned !== value.hits.length) context.addIssue({ code: "custom", path: ["returned"], message: "returned must equal hit count" });
  if (value.partial !== (value.branchFailures.length > 0)) context.addIssue({ code: "custom", path: ["partial"], message: "partial must match branch failures" });
  if (new Set(value.branchFailures.map((failure) => failure.scope)).size !== value.branchFailures.length) context.addIssue({ code: "custom", path: ["branchFailures"], message: "branch failure scopes must be unique" });
  for (const [index, failure] of value.branchFailures.entries()) {
    const [, retryable, nextAction] = MEMORY_ERROR_POLICY[failure.code];
    if (failure.retryable !== retryable || failure.nextAction !== nextAction) context.addIssue({ code: "custom", path: ["branchFailures", index], message: "branch failure disposition contradicts code" });
  }
});
export type RecallResult = z.infer<typeof RecallResultSchema>;

export const ReflectRequestSchema = z.strictObject({ bankId: Id, query: z.string().min(1).max(16_384), budget: z.enum(["low", "mid", "high"]), maxTokens: z.int().min(1).max(32_000) });
export type ReflectRequest = z.infer<typeof ReflectRequestSchema>;
const JsonObject = z.record(z.string().min(1).max(128), JsonValueSchema).refine((value) => Object.keys(value).length <= 256);
export const ReflectResultSchema = z.strictObject({ text: z.string().max(100_000), structuredContent: JsonObject.nullable(), evidence: z.strictObject({ memoryIds: z.array(Id).max(128), mentalModelIds: z.array(Id).max(128), directiveIds: z.array(Id).max(128) }), usage: z.strictObject({ inputTokens: z.int().min(0).nullable(), outputTokens: z.int().min(0).nullable() }), trace: JsonObject.nullable() });
export type ReflectResult = z.infer<typeof ReflectResultSchema>;

export const EditableMemoryPatchSchema = z.strictObject({
  text: z.string().min(1).max(100_000).optional(), context: z.string().max(16_384).nullable().optional(),
  occurredStart: Timestamp.nullable().optional(), occurredEnd: Timestamp.nullable().optional(), factType: z.enum(["world", "experience"]).optional(),
  entities: z.array(Id).max(128).optional(), layerId: Id.optional(),
}).superRefine((value, context) => {
  if (Object.keys(value).length === 0) context.addIssue({ code: "custom", message: "edit patch cannot be empty" });
  if (value.occurredStart && value.occurredEnd && value.occurredStart > value.occurredEnd) context.addIssue({ code: "custom", path: ["occurredEnd"], message: "occurrence range is reversed" });
});
export type EditableMemoryPatch = z.infer<typeof EditableMemoryPatchSchema>;
export const MutationRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("edit"), bankId: Id, memoryId: Id, expectedRevision: z.int().min(1), patch: EditableMemoryPatchSchema }),
  z.strictObject({ kind: z.literal("invalidate"), bankId: Id, memoryId: Id, expectedRevision: z.int().min(1), reason: z.string().max(512).nullable() }),
  z.strictObject({ kind: z.literal("restore"), bankId: Id, memoryId: Id, expectedRevision: z.int().min(1) }),
]);
export type MutationRequest = z.infer<typeof MutationRequestSchema>;
export const UpdateMemoryRequestSchema = z.strictObject({ bankId: Id, memoryId: Id, expectedRevision: z.int().min(1), patch: EditableMemoryPatchSchema });
export const InvalidateMemoryRequestSchema = z.strictObject({ bankId: Id, memoryId: Id, expectedRevision: z.int().min(1), reason: z.string().max(512).nullable() });
export const RestoreMemoryRequestSchema = z.strictObject({ bankId: Id, memoryId: Id, expectedRevision: z.int().min(1) });
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequestSchema>;
export type InvalidateMemoryRequest = z.infer<typeof InvalidateMemoryRequestSchema>;
export type RestoreMemoryRequest = z.infer<typeof RestoreMemoryRequestSchema>;
export const MutationResultSchema = z.strictObject({ outcome: z.enum(["applied", "unchanged"]), record: CanonicalMemoryRecordSchema });
export type MutationResult = z.infer<typeof MutationResultSchema>;
export const EditResultSchema = MutationResultSchema;
export const InvalidateResultSchema = MutationResultSchema;
export const RestoreResultSchema = MutationResultSchema;
