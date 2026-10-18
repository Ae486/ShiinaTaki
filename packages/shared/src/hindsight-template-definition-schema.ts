/**
 * INPUT:  bounded Native template definitions and explicit stored override presence
 * OUTPUT: complete strict lifecycle definition schemas with lossless JSON and UTF-8 limits
 * POS:    shared Hindsight contract — lifecycle-v1; immutable legacy v1/codec shapes are unchanged
 */
import { z } from "zod";
import { createHindsightJsonSchemas } from "./hindsight-json-schema.ts";

export const HINDSIGHT_TEMPLATE_BUILD = "taki-memory-hindsight-0.9.0-template-lifecycle-v1";
export const HINDSIGHT_TEMPLATE_VERSION = "1.0.0";
export const HINDSIGHT_TEMPLATE_MAX_BYTES = 524_288;
const utf8 = new TextEncoder();
export const HindsightTemplateHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const HindsightTemplateIdSchema = z.string().min(1).refine((value) => scalarText(value) && [...value].length <= 256);
export const HindsightTemplateTextSchema = z.string().refine((value) => scalarText(value) && utf8.encode(value).length <= 20_000);
export const HindsightTemplateNameSchema = HindsightTemplateTextSchema.refine((value) => value.length > 0 && utf8.encode(value).length <= 512);
export const HindsightTemplateTagsSchema = z.array(HindsightTemplateNameSchema).max(32);
export const HindsightTemplateModelIdSchema = HindsightTemplateIdSchema.regex(/^[a-z0-9][a-z0-9-]*$/);
// The legacy helper counts UTF-16 units. Permit 256 there, then enforce the
// lifecycle's 128 Unicode scalar limit below; legacy callers retain their limit.
export const HindsightTemplateJsonSchema = createHindsightJsonSchemas(20_000, 256).value.refine(boundedTemplateJson);
export const HindsightTemplateObjectSchema = createHindsightJsonSchemas(20_000, 256).object.refine(boundedTemplateJson);
export const HindsightTemplateConfigKeySchema = z.enum(["retain_mission", "observations_instructions", "reflect_mission", "entity_labels"]);
export type HindsightTemplateConfigKey = z.infer<typeof HindsightTemplateConfigKeySchema>;

function scalarText(value: string): boolean { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }

function boundedTemplateJson(value: unknown): boolean {
  const stack = [{ value, depth: 0 }]; let nodes = 0;
  while (stack.length) {
    const item = stack.pop(); if (!item || ++nodes > 4096 || item.depth > 32) return false;
    if (typeof item.value === "string" && (!scalarText(item.value) || utf8.encode(item.value).length > 20_000)) return false;
    if (item.value && typeof item.value === "object") {
      const entries = Object.entries(item.value);
      if (entries.length > 256 || entries.some(([key]) => !scalarText(key) || [...key].length > 128)) return false;
      stack.push(...entries.map(([, child]) => ({ value: child, depth: item.depth + 1 })));
    }
  }
  return true;
}

const TagsMatch = z.enum(["any", "all", "any_strict", "all_strict", "exact"]);
type TagGroup = { tags: string[]; match?: z.infer<typeof TagsMatch> } | { and: TagGroup[] } | { or: TagGroup[] } | { not: TagGroup };
const TagGroupSchema: z.ZodType<TagGroup> = z.lazy(() => z.union([
  z.strictObject({ tags: HindsightTemplateTagsSchema, match: TagsMatch.optional() }),
  z.strictObject({ and: z.array(TagGroupSchema).max(256) }), z.strictObject({ or: z.array(TagGroupSchema).max(256) }),
  z.strictObject({ not: TagGroupSchema }),
]));
const Trigger = z.strictObject({
  mode: z.enum(["full", "delta"]).optional(), refresh_after_consolidation: z.boolean().optional(),
  refresh_cron: HindsightTemplateTextSchema.nullable().optional(),
  fact_types: z.array(z.enum(["world", "experience", "observation"])).min(1).max(256).nullable().optional(),
  exclude_mental_models: z.boolean().optional(), exclude_mental_model_ids: z.array(HindsightTemplateModelIdSchema).max(256).nullable().optional(),
  tags_match: TagsMatch.nullable().optional(), tag_groups: z.array(TagGroupSchema).max(256).nullable().optional(),
  include_chunks: z.boolean().nullable().optional(), recall_max_tokens: z.int().nullable().optional(),
  recall_chunks_max_tokens: z.int().nullable().optional(),
  response_schema: HindsightTemplateObjectSchema.refine(validResponseSchema, "unsupported structured response schema").nullable().optional(),
  keep_trace: z.boolean().optional(),
}).refine((value) => !(value.refresh_after_consolidation && value.refresh_cron?.trim()), "incompatible refresh triggers");
export const HindsightTemplateTriggerSchema = z.unknown().refine((value) => HindsightTemplateJsonSchema.safeParse(value).success).pipe(Trigger);

export const HindsightTemplateModelDefinitionSchema = z.strictObject({
  id: HindsightTemplateModelIdSchema, name: HindsightTemplateNameSchema,
  source_query: HindsightTemplateTextSchema.refine((value) => value.length > 0),
  tags: HindsightTemplateTagsSchema, max_tokens: z.int().min(256).max(8192), trigger: HindsightTemplateTriggerSchema.nullable(),
});
export type HindsightTemplateModelDefinition = z.infer<typeof HindsightTemplateModelDefinitionSchema>;
export const HindsightTemplateDirectiveDefinitionSchema = z.strictObject({
  id: z.uuid().transform((value) => value.toLowerCase()), name: HindsightTemplateNameSchema,
  content: HindsightTemplateTextSchema.refine((value) => value.length > 0), priority: z.int().min(-1000).max(1000),
  is_active: z.boolean(), tags: HindsightTemplateTagsSchema,
});
export type HindsightTemplateDirectiveDefinition = z.infer<typeof HindsightTemplateDirectiveDefinitionSchema>;

export const HindsightTemplatePresenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("absent") }), z.strictObject({ kind: z.literal("null_tombstone") }),
  z.strictObject({ kind: z.literal("value"), value: HindsightTemplateJsonSchema.refine((value) => value !== null) }),
]);
export type HindsightTemplatePresence = z.infer<typeof HindsightTemplatePresenceSchema>;
export const HindsightTemplateTargetSchema = z.strictObject({
  provider_lineage: z.uuid().transform((value) => value.toLowerCase()), bank_id: HindsightTemplateIdSchema,
  bank_generation: z.uuid().transform((value) => value.toLowerCase()),
});
export type HindsightTemplateTarget = z.infer<typeof HindsightTemplateTargetSchema>;

export const HindsightTemplateConfigEntrySchema = z.strictObject({
  key: HindsightTemplateConfigKeySchema, stored: HindsightTemplatePresenceSchema, inherited: HindsightTemplateJsonSchema,
}).refine((value) => isHindsightTemplateConfigValue(value.key, value.inherited)
  && (value.stored.kind !== "value" || isHindsightTemplateConfigValue(value.key, value.stored.value)), "invalid template config value");
export const HindsightTemplateSelectorsSchema = z.strictObject({
  config_keys: z.array(HindsightTemplateConfigKeySchema).max(4), model_ids: z.array(HindsightTemplateModelIdSchema).max(64),
  directives: z.array(z.strictObject({ id: z.uuid().transform((value) => value.toLowerCase()), name: HindsightTemplateNameSchema })).max(64),
}).superRefine((value, context) => {
  const sets = [value.config_keys, value.model_ids, value.directives.map((item) => item.id), value.directives.map((item) => item.name)];
  if (sets.some((items) => new Set(items).size !== items.length)) context.addIssue({ code: "custom", message: "duplicate selectors" });
});
export type HindsightTemplateSelectors = z.infer<typeof HindsightTemplateSelectorsSchema>;

// No defaults are expanded here: stored legacy spelling and omitted optional fields
// are part of the before-image. Native additionally runs its existing semantic validators.
const LabelValue = z.strictObject({ value: HindsightTemplateNameSchema, description: HindsightTemplateTextSchema.optional() });
type LabelField = {
  type?: "text" | "value" | "multi-values" | "map"; description?: string;
  values?: z.infer<typeof LabelValue>[]; fields?: Record<string, unknown>;
};
const LabelFieldSchema: z.ZodType<LabelField> = z.lazy(() => z.strictObject({
  type: z.enum(["text", "value", "multi-values", "map"]).optional(), description: HindsightTemplateTextSchema.optional(),
  values: z.array(LabelValue).max(64).optional(),
  fields: HindsightTemplateObjectSchema.refine((value) => Object.entries(value).every(([key, field]) =>
    HindsightTemplateNameSchema.safeParse(key).success && LabelFieldSchema.safeParse(field).success)).optional(),
}).refine((value) => !value.values || new Set(value.values.map((item) => item.value)).size === value.values.length,
  "duplicate nested label values"));
export const HindsightTemplateLabelGroupSchema = z.strictObject({
  key: HindsightTemplateNameSchema, description: HindsightTemplateTextSchema.optional(),
  type: z.enum(["text", "value", "multi-values", "map"]).optional(), optional: z.boolean().optional(), tag: z.boolean().optional(),
  values: z.array(LabelValue).max(64).optional(),
  fields: HindsightTemplateObjectSchema.refine((value) => Object.entries(value).every(([key, field]) =>
    HindsightTemplateNameSchema.safeParse(key).success && LabelFieldSchema.safeParse(field).success)).optional(),
  free_values: z.boolean().optional(), multi_value: z.boolean().optional(),
}).refine((value) => !value.values || new Set(value.values.map((item) => item.value)).size === value.values.length,
  "duplicate label values");
export type HindsightTemplateLabelGroup = z.infer<typeof HindsightTemplateLabelGroupSchema>;
const LabelGroups = z.array(HindsightTemplateLabelGroupSchema).max(32).refine((value) =>
  new Set(value.map((item) => item.key)).size === value.length, "duplicate label groups");
export const HindsightTemplateLabelsSchema = HindsightTemplateJsonSchema.pipe(z.union([
  LabelGroups, z.strictObject({ attributes: LabelGroups }), z.null(),
]));
export type HindsightTemplateLabels = z.infer<typeof HindsightTemplateLabelsSchema>;

export function isHindsightTemplateConfigValue(key: HindsightTemplateConfigKey, value: unknown): boolean {
  return key === "entity_labels" ? HindsightTemplateLabelsSchema.safeParse(value).success
    : value === null || HindsightTemplateTextSchema.safeParse(value).success;
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validResponseSchema(value: Record<string, unknown>): boolean {
  // Native's structured-output producer builds a flat model from properties.
  // Match that semantic contract without expanding or stripping supplied keys.
  if (value.type != null && value.type !== "object") return false;
  const properties = value.properties;
  if (!jsonObject(properties) || Object.keys(properties).length === 0) return false;
  const types = new Set<unknown>(["string", "number", "integer", "boolean", "array", "object"]);
  if (Object.values(properties).some((property) => !jsonObject(property) || (property.type != null && !types.has(property.type)))) return false;
  return value.required == null || (Array.isArray(value.required)
    && value.required.every((key) => typeof key === "string" && Object.hasOwn(properties, key)));
}
