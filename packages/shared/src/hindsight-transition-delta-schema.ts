/**
 * INPUT:  complete current Local descriptors and only changed native/application bodies
 * OUTPUT: baseline-discriminated re-entry commands and exact immutable delta lineage
 * POS:    shared transition transfer wire — preserves the existing D78 and D77 protocols
 */
import { z } from "zod";
import { HindsightCurrentSourceWitnessSchema, HindsightCurrentDocumentSchema, HindsightCurrentChunkSchema,
  HindsightCurrentUnitSchema, HindsightCurrentMentalModelSchema, HindsightCurrentDirectiveSchema } from "./hindsight-current-state-schema.ts";
import { TakiApplicationHashSchema as Hash, TakiApplicationIdSchema as Id, TakiApplicationCountSchema as Count,
  TakiApplicationRevisionSchema as Revision, TakiApplicationObjectKindSchema as Kind,
  TakiApplicationArtifactKeySchema as Key, TakiApplicationArtifactVersionSchema as Version, TakiApplicationBodyRefSchema } from "./hindsight-application-primitives-schema.ts";
import { TakiApplicationBankBodySchema, TakiApplicationSourceBodySchema, TakiApplicationBlockBodySchema } from "./hindsight-application-artifact-schema.ts";
import { TakiApplicationMemoryBodySchema } from "./memory-policy-assessment-schema.ts";
import { TakiApplicationNativeBankPayloadSchema } from "./hindsight-application-native-schema.ts";
import { HindsightTransitionExecutorSchema, HindsightTransitionUnusedScopeSchema } from "./hindsight-transition-schema.ts";

const Target = z.strictObject({ object_kind: Kind, object_id: Id, object_revision: Revision, payload_hash: Hash });
const Retirement = z.strictObject({ source_record_id: Id, source_revision: Revision,
  reason: z.enum(["explicit_delete", "expired", "scope_retired"]), retired_at: z.string(), evidence_hash: Hash });
export const HindsightTransitionNativeDescriptorSchema = z.strictObject({ source: HindsightCurrentSourceWitnessSchema,
  target: Target.nullable(), disposition: z.enum(["reuse", "upsert", "delete"]), body_hash: Hash.nullable(),
  retirement: Retirement.nullable().default(null),
}).superRefine((value, context) => {
  if (value.target && value.target.object_kind !== value.source.source_kind
    || value.disposition !== "upsert" && (!value.target || value.body_hash !== null)
    || value.disposition === "upsert" && value.body_hash === null
    || value.source.source_kind === "bank" && (!value.target || value.disposition === "delete")
    || (value.disposition === "delete") !== (value.retirement !== null)
    || value.retirement && (value.retirement.source_record_id !== value.source.source_id || value.retirement.source_revision !== value.source.source_revision)) {
    context.addIssue({ code: "custom", message: "native descriptor identity/body/lifecycle mismatch" });
  }
});
export type HindsightTransitionNativeDescriptor = z.infer<typeof HindsightTransitionNativeDescriptorSchema>;
const MemoryInput = TakiApplicationMemoryBodySchema.omit({ assessment: true, source_artifacts: true })
  .extend({ source_artifacts: z.array(Key) });
const MemoryEvidenceInput = TakiApplicationMemoryBodySchema.omit({ assessment: true, source_artifacts: true })
  .extend({ source_artifacts: z.array(z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("existing"), version: Version }),
    z.strictObject({ kind: z.literal("delta"), key: Key })])) });
const Body = z.discriminatedUnion("artifact_kind", [
  z.strictObject({ artifact_kind: z.literal("bank"), body: TakiApplicationBankBodySchema }),
  z.strictObject({ artifact_kind: z.literal("source"), body: TakiApplicationSourceBodySchema }),
  z.strictObject({ artifact_kind: z.literal("source_evidence"), body: z.strictObject({ source_ref: TakiApplicationBodyRefSchema,
    expected_document: Target }).refine((value) => value.source_ref.body_schema === "application-source.v1"
      && value.expected_document.object_kind === "document", "Source evidence input kind mismatch") }),
  z.strictObject({ artifact_kind: z.literal("memory"), body: MemoryInput }),
  z.strictObject({ artifact_kind: z.literal("memory_evidence"), body: MemoryEvidenceInput }),
  z.strictObject({ artifact_kind: z.literal("block"), body: TakiApplicationBlockBodySchema }),
]);
export const HindsightTransitionApplicationDescriptorSchema = z.strictObject({ key: Key, expected_artifact: Version.nullable(),
  expected_body_hash: Hash.nullable(), source_record_hash: Hash, disposition: z.enum(["reuse", "upsert", "retire"]),
  native_source_id: Id.nullable(), body: Body.nullable(), retirement: Retirement.nullable().default(null),
}).superRefine((value, context) => {
  if ((value.expected_artifact === null) !== (value.expected_body_hash === null)
    || value.expected_artifact && (value.expected_artifact.key.artifact_kind !== value.key.artifact_kind || value.expected_artifact.key.artifact_id !== value.key.artifact_id)
    || (value.disposition === "upsert") !== (value.body !== null)
    || value.disposition !== "upsert" && !value.expected_artifact
    || value.body && (value.body.artifact_kind === "source_evidence" ? "source" : value.body.artifact_kind === "memory_evidence" ? "memory" : value.body.artifact_kind) !== value.key.artifact_kind
    || value.body?.artifact_kind === "source_evidence" && value.expected_artifact === null
    || (value.disposition === "retire") !== (value.retirement !== null)) {
    context.addIssue({ code: "custom", message: "application descriptor predecessor/body/retirement mismatch" });
  }
});
export type HindsightTransitionApplicationDescriptor = z.infer<typeof HindsightTransitionApplicationDescriptorSchema>;
export const HindsightTransitionDeltaRequestSchema = z.strictObject({ protocol: z.literal("taki-transition-v1").default("taki-transition-v1"),
  executor: HindsightTransitionExecutorSchema, operation_id: z.uuid(), request_hash: Hash, baseline_transition_id: z.uuid().nullable(),
  baseline_proof_hash: Hash.nullable(), unused_scope: HindsightTransitionUnusedScopeSchema.nullable().default(null), local_manifest_hash: Hash,
  native: z.array(HindsightTransitionNativeDescriptorSchema).min(1).max(10_000),
  chunks: z.array(z.strictObject({ source_chunk_id: Id, source_document_id: Id, target_chunk_id: Id.nullable(), chunk_index: Count,
    content_hash: Hash, disposition: z.enum(["reuse", "upsert", "delete"]) })).max(10_000),
  application: z.array(HindsightTransitionApplicationDescriptorSchema).max(10_000),
  rows: z.strictObject({ bank: z.strictObject({ source: HindsightCurrentSourceWitnessSchema,
    payload: TakiApplicationNativeBankPayloadSchema }).nullable().default(null),
    documents: z.array(HindsightCurrentDocumentSchema).default([]), chunks: z.array(HindsightCurrentChunkSchema).default([]),
    memory_units: z.array(HindsightCurrentUnitSchema).default([]), mental_models: z.array(HindsightCurrentMentalModelSchema).default([]),
    directives: z.array(HindsightCurrentDirectiveSchema).default([]) }),
}).superRefine((value, context) => {
  if ((value.baseline_transition_id === null) !== (value.baseline_proof_hash === null)
    || Number(value.baseline_transition_id !== null) + Number(value.unused_scope !== null) !== 1) {
    context.addIssue({ code: "custom", message: "delta requires exactly one real baseline" });
  }
});
export type HindsightTransitionDeltaRequest = z.infer<typeof HindsightTransitionDeltaRequestSchema>;
export const HindsightTransitionDeltaResultSchema = z.strictObject({ protocol: z.literal("taki-transition-v1"),
  operation_id: z.uuid(), transition_id: z.uuid(), bank_id: Id, provider_lineage: z.uuid(), bank_generation: z.uuid(),
  request_hash: Hash, baseline_proof_hash: Hash.nullable(), unused_scope_hash: Hash.nullable().default(null), local_manifest_hash: Hash,
  native_before_cursor: Count, native_through_cursor: Count, application_through_cursor: Count,
  mappings: z.array(z.strictObject({ source: HindsightCurrentSourceWitnessSchema, target: Target.nullable(),
    disposition: z.enum(["reused", "upserted", "deleted"]) })),
  artifacts: z.array(z.strictObject({ key: Key, previous: Version.nullable(), previous_body_hash: Hash.nullable(), current: Version,
    source_record_hash: Hash, disposition: z.enum(["reused", "upserted", "retired"]) })), result_hash: Hash });
export type HindsightTransitionDeltaResult = z.infer<typeof HindsightTransitionDeltaResultSchema>;
