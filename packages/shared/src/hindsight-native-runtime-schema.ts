/**
 * INPUT:  native Hindsight 0.9.0 recall/reflect request bodies and untrusted responses
 * OUTPUT: validated native fields, preserving omitted values, nulls, and typed JSON
 * POS:    shared native read wire — reused by ordinary reads and guarded application reflection; no policy admission
 */
import { z } from "zod";
import { RecallRequestSchema } from "./memory-provider-operation-schema.ts";
import type { JsonValue } from "./memory-provider-domain-schema.ts";

const NativeString = z.string();
const FactType = z.enum(["world", "experience", "observation"]);
const TagsMatch = z.enum(["any", "all", "any_strict", "all_strict", "exact"]);
// Native wire values keep their own domain; the snapshot and Canonical quotas do not govern these fields.
const JsonObject = z.custom<Record<string, JsonValue>>((value) => isJsonObject(value) && isAcyclicJson(value), "invalid native JSON object");
const Tokens = RecallRequestSchema.shape.maxTokens;
const IncludeTokens = Tokens.or(z.literal(0));
const SourceFactTokens = IncludeTokens.or(z.literal(-1));

const TagLeaf = z.strictObject({ tags: z.array(NativeString), match: TagsMatch.optional() });
type TagGroup = z.infer<typeof TagLeaf> | { and: TagGroup[] } | { or: TagGroup[] } | { not: TagGroup };
const TagGroupSchema: z.ZodType<TagGroup> = z.lazy(() => z.union([
  TagLeaf,
  z.strictObject({ and: z.array(TagGroupSchema) }),
  z.strictObject({ or: z.array(TagGroupSchema) }),
  z.strictObject({ not: TagGroupSchema }),
]));
const TagGroupInputSchema = z.unknown().refine(isAcyclicJson, "invalid tag group JSON")
  .pipe(TagGroupSchema);
const filters = {
  tags: z.array(NativeString).nullable().optional(),
  tags_match: TagsMatch.optional(),
  tag_groups: z.array(TagGroupInputSchema).nullable().optional(),
};
const query = {
  query: RecallRequestSchema.shape.query,
  budget: RecallRequestSchema.shape.budget.optional(),
  max_tokens: Tokens.optional(),
};

// Native defaults stay on the server. In particular, absent tags and [] are meaningful with exact matching.
export const HindsightNativeRecallRequestSchema = z.strictObject({
  ...query, ...filters,
  types: z.array(FactType).nullable().optional(),
  prefer_observations: z.boolean().optional(),
  trace: z.boolean().optional(),
  query_timestamp: NativeString.nullable().optional(),
  include: z.strictObject({
    entities: z.strictObject({ max_tokens: IncludeTokens.optional() }).nullable().optional(),
    chunks: z.strictObject({ max_tokens: IncludeTokens.optional() }).nullable().optional(),
    source_facts: z.strictObject({
      max_tokens: SourceFactTokens.optional(), max_tokens_per_observation: SourceFactTokens.optional(),
    }).nullable().optional(),
  }).optional(),
  min_scores: z.strictObject({
    semantic: z.number().finite().nullable().optional(), keyword: z.number().finite().nullable().optional(),
    reranker: z.number().finite().nullable().optional(), final: z.number().finite().nullable().optional(),
  }).nullable().optional(),
}).refine((value) => value.tags == null || value.tag_groups == null, "tags and tag_groups are mutually exclusive");

export const HindsightNativeReflectRequestSchema = z.strictObject({
  ...query, ...filters,
  context: NativeString.nullable().optional(),
  include: z.strictObject({
    facts: z.strictObject({}).nullable().optional(),
    tool_calls: z.strictObject({ output: z.boolean().optional() }).nullable().optional(),
  }).optional(),
  response_schema: JsonObject.nullable().optional(),
  apply_all_directives: z.boolean().optional(),
  fact_types: z.array(FactType).min(1).nullable().optional(),
  exclude_mental_models: z.boolean().optional(),
  exclude_mental_model_ids: z.array(NativeString).nullable().optional(),
}).refine((value) => value.tags == null || value.tag_groups == null, "tags and tag_groups are mutually exclusive");

const Scores = z.object({
  final: z.number().finite(), reranker: z.number().finite().nullable().optional(),
  semantic: z.number().finite().nullable().optional(), keyword: z.number().finite().nullable().optional(),
});
export const HindsightNativeRecallResultSchema = z.object({
  id: NativeString, text: NativeString,
  type: NativeString.nullable().optional(), entities: z.array(NativeString).nullable().optional(),
  context: NativeString.nullable().optional(),
  occurred_start: NativeString.nullable().optional(), occurred_end: NativeString.nullable().optional(),
  mentioned_at: NativeString.nullable().optional(), document_id: NativeString.nullable().optional(),
  metadata: JsonObject.nullable().optional(), chunk_id: NativeString.nullable().optional(),
  tags: z.array(NativeString).nullable().optional(), source_fact_ids: z.array(NativeString).nullable().optional(),
  scores: Scores.nullable().optional(),
});
const EntityState = z.object({
  entity_id: NativeString, canonical_name: NativeString,
  observations: z.array(z.object({ text: NativeString, mentioned_at: NativeString.nullable().optional() })),
});
const Chunk = z.object({ id: NativeString, text: NativeString, chunk_index: z.int().min(0), truncated: z.boolean().optional() });

export const HindsightNativeRecallResponseSchema = z.object({
  results: z.array(HindsightNativeRecallResultSchema),
  trace: JsonObject.nullable().optional(),
  entities: nativeMap(EntityState).nullable().optional(),
  chunks: nativeMap(Chunk).nullable().optional(),
  source_facts: nativeMap(HindsightNativeRecallResultSchema).nullable().optional(),
});

const ReflectFact = z.object({
  id: NativeString.nullable().optional(), text: NativeString, type: NativeString.nullable().optional(), context: NativeString.nullable().optional(),
  occurred_start: NativeString.nullable().optional(), occurred_end: NativeString.nullable().optional(),
});
const ReflectBasedOn = z.object({
  memories: z.array(ReflectFact).optional(),
  mental_models: z.array(z.object({ id: NativeString, text: NativeString, context: NativeString.nullable().optional() })).optional(),
  directives: z.array(z.object({ id: NativeString, name: NativeString, content: NativeString })).optional(),
});
// Missing usage remains missing; the client must not manufacture the native model's default zero values.
const TokenUsage = z.object({
  input_tokens: z.int().min(0).optional(), output_tokens: z.int().min(0).optional(),
  total_tokens: z.int().min(0).optional(), cached_tokens: z.int().min(0).optional(), thoughts_tokens: z.int().min(0).optional(),
});
const ReflectTrace = z.object({
  tool_calls: z.array(z.object({
    tool: NativeString, input: JsonObject, output: JsonObject.nullable().optional(), duration_ms: z.int().min(0),
    iteration: z.int().min(0).optional(),
  })).optional(),
  llm_calls: z.array(z.object({ scope: NativeString, duration_ms: z.int().min(0) })).optional(),
});
export const HindsightNativeReflectResponseSchema = z.object({
  text: NativeString,
  based_on: ReflectBasedOn.nullable().optional(), structured_output: JsonObject.nullable().optional(),
  usage: TokenUsage.nullable().optional(), trace: ReflectTrace.nullable().optional(),
});

export type HindsightNativeRecallRequest = z.infer<typeof HindsightNativeRecallRequestSchema>;
export type HindsightNativeRecallResponse = z.infer<typeof HindsightNativeRecallResponseSchema>;
export type HindsightNativeReflectRequest = z.infer<typeof HindsightNativeReflectRequestSchema>;
export type HindsightNativeReflectResponse = z.infer<typeof HindsightNativeReflectResponseSchema>;

function isAcyclicJson(root: unknown): boolean {
  // Validate without quotas or recursion, preserving shared subtrees while refusing cycles and accessor execution.
  const stack: Array<{ value: unknown; exit?: boolean }> = [{ value: root }];
  const ancestors = new Set<object>();
  while (stack.length) {
    const frame = stack.pop(); if (!frame) return false;
    const value = frame.value;
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") { if (!Number.isFinite(value)) return false; continue; }
    if (typeof value !== "object") return false;
    if (frame.exit) { ancestors.delete(value); continue; }
    const array = Array.isArray(value);
    if (ancestors.has(value) || !array && !isJsonObject(value)) return false;
    const keys = Object.keys(value);
    if (Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== keys.length + (array ? 1 : 0)) return false;
    if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) return false;
    ancestors.add(value); stack.push({ value, exit: true });
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return false;
      stack.push({ value: descriptor.value });
    }
  }
  return true;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function nativeMap<T extends z.ZodType>(entry: T) {
  return JsonObject.transform((value, context): Record<string, z.output<T>> => {
    const entries: Array<[string, z.output<T>]> = [];
    for (const [key, item] of Object.entries(value)) {
      const parsed = entry.safeParse(item);
      if (!parsed.success) {
        context.addIssue({ code: "custom", message: "invalid native result map" });
        return z.NEVER;
      }
      entries.push([key, parsed.data]);
    }
    // Assignment/record parsing can lose __proto__; entity names and source IDs remain opaque own keys.
    return Object.fromEntries(entries);
  });
}
