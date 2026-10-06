/**
 * INPUT:  complete native logical payloads referenced by immutable D77 body descriptors
 * OUTPUT: kind-checked native evidence and separately hashed original document evidence
 * POS:    shared application-state wire — native payload validation does not fabricate Canonical policy or provenance
 */
import { z } from "zod";
import { TakiApplicationJsonObjectSchema as JsonObject } from "./hindsight-application-json.ts";
import { TakiApplicationBodyRefSchema, TakiApplicationNativeVersionSchema, TakiApplicationHashSchema,
  TakiApplicationNativeTombstoneSchema, TakiApplicationObjectKindSchema, TakiApplicationIdSchema,
  TakiApplicationArtifactVersionSchema } from "./hindsight-application-primitives-schema.ts";

const Text = z.string(); const NullableText = Text.nullable(); const Tags = z.array(Text);
const Scopes = z.union([Text, z.array(z.array(Text))]).nullable();
const Times = { created_at: Text, updated_at: Text };
export const TakiApplicationNativeBankPayloadSchema = z.strictObject({ bank_id: Text, name: Text, disposition: z.strictObject({
  skepticism: z.number(), literalism: z.number(), empathy: z.number(),
}), mission: Text, config: JsonObject, ...Times });
const Source = z.strictObject({ document_id: Text, bank_id: Text, content_hash: NullableText,
  tags: Tags, metadata: JsonObject, observation_scopes: Scopes, ...Times });
const Memory = z.strictObject({
  memory_id: Text, bank_id: Text, document_id: NullableText, chunk_id: NullableText, text: Text,
  context: NullableText, fact_type: Text, state: z.enum(["valid", "invalidated"]), revision: z.int().min(1),
  tags: Tags, metadata: JsonObject, entities: Tags, source_memory_ids: Tags, observation_scopes: Scopes,
  event_date: NullableText, occurred_start: NullableText, occurred_end: NullableText, mentioned_at: NullableText,
  ...Times, edited_at: NullableText, consolidated_at: NullableText, consolidation_failed_at: NullableText,
  invalidation_reason: NullableText, invalidated_at: NullableText, proof_count: z.int().min(1),
});
const MentalModel = z.strictObject({ mental_model_id: Text, bank_id: Text, subtype: Text, name: Text,
  source_query: NullableText, content: NullableText, tags: Tags, max_tokens: z.int().nullable(), trigger: JsonObject.nullable(),
  last_refreshed_at: NullableText, created_at: Text, reflect_response: JsonObject.nullable(), structured_content: JsonObject.nullable() });
const Directive = z.strictObject({ directive_id: Text, bank_id: Text, name: Text, content: Text,
  priority: z.int(), is_active: z.boolean(), tags: Tags, ...Times });

export const TakiApplicationNativePayloadSchema = z.union([TakiApplicationNativeBankPayloadSchema, Source, Memory, MentalModel, Directive]);
export type TakiApplicationNativePayload = z.infer<typeof TakiApplicationNativePayloadSchema>;
export const TakiApplicationNativeRecordSchema = z.strictObject({
  version: TakiApplicationNativeVersionSchema, payload: TakiApplicationNativePayloadSchema,
  source_evidence_ref: TakiApplicationBodyRefSchema.nullable(),
}).superRefine((value, context) => {
  const schemas = { bank: TakiApplicationNativeBankPayloadSchema, document: Source, memory_unit: Memory, mental_model: MentalModel, directive: Directive };
  const keys = { bank: "bank_id", document: "document_id", memory_unit: "memory_id", mental_model: "mental_model_id", directive: "directive_id" };
  const payload = value.payload as Record<string, unknown>; const kind = value.version.object_kind;
  if (!schemas[kind].safeParse(payload).success || payload[keys[kind]] !== value.version.object_id
    || (kind === "memory_unit" && payload.revision !== value.version.object_revision)) {
    context.addIssue({ code: "custom", path: ["payload"], message: "native payload identity and version disagree" });
  }
});
export type TakiApplicationNativeRecord = z.infer<typeof TakiApplicationNativeRecordSchema>;
export const TakiApplicationNativeSourceEvidenceSchema = z.strictObject({
  document_version: TakiApplicationNativeVersionSchema, original_text: NullableText, context: NullableText,
  source_metadata: JsonObject, availability: z.enum(["available", "unavailable"]), source_evidence_hash: TakiApplicationHashSchema,
});
export type TakiApplicationNativeSourceEvidence = z.infer<typeof TakiApplicationNativeSourceEvidenceSchema>;
export const TakiApplicationNativeHeadSchema = z.strictObject({
  object_kind: TakiApplicationObjectKindSchema, object_id: TakiApplicationIdSchema,
  version: TakiApplicationNativeVersionSchema.nullable(), tombstone: TakiApplicationNativeTombstoneSchema.nullable(),
  body_ref: TakiApplicationBodyRefSchema.nullable(),
  binding_state: z.enum(["binding_missing", "bound", "rebind_required", "tombstoned", "not_applicable"]),
  bound_artifact: TakiApplicationArtifactVersionSchema.nullable(), previous_version: TakiApplicationNativeVersionSchema.nullable(),
  cause: z.enum(["baseline", "native_change", "application_commit", "native_delete"]),
});
export type TakiApplicationNativeHead = z.infer<typeof TakiApplicationNativeHeadSchema>;
