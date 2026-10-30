/**
 * INPUT:  independently persisted Taki policy, native assessment targets and original memory evidence
 * OUTPUT: strict D77 memory-body and assessment contracts, plus the shared importance default
 * POS:    shared application-state policy — assessment never changes Canonical or Pending write contracts
 */
import { z } from "zod";
import { TakiApplicationJsonObjectSchema } from "./hindsight-application-json.ts";
import { TakiApplicationArtifactVersionSchema, TakiApplicationCountSchema, TakiApplicationHashSchema,
  TakiApplicationNativeVersionSchema, TakiApplicationTimeSchema } from "./hindsight-application-primitives-schema.ts";
import { HindsightCurrentCanonicalRecordSchema } from "./hindsight-current-canonical-schema.ts";
import { MemoryProvenanceSchema, TakiMemoryPolicyProjectionSchema } from "./memory-provider-domain-schema.ts";

/** Existing automatic-writer midpoint, also used by explicitly declared neutral policy. */
export const TAKI_MEMORY_DEFAULT_IMPORTANCE = 5;

export const TakiApplicationPolicyBasisSchema = z.enum(["neutral", "registry", "curated"]);
export type TakiApplicationPolicyBasis = z.infer<typeof TakiApplicationPolicyBasisSchema>;
export const TakiApplicationAssessmentFailureSchema = z.enum([
  "model_unavailable", "model_failed", "invalid_result", "revision_conflict", "cancelled",
]);
export type TakiApplicationAssessmentFailure = z.infer<typeof TakiApplicationAssessmentFailureSchema>;

export const TakiApplicationAssessmentSchema = z.strictObject({
  state: z.enum(["not_required", "due", "failed", "assessed"]),
  target: TakiApplicationNativeVersionSchema,
  attempts: TakiApplicationCountSchema,
  next_attempt_at: TakiApplicationTimeSchema.nullable(),
  last_failure_code: TakiApplicationAssessmentFailureSchema.nullable(),
  prompt_version: z.string().nullable(),
  prompt_hash: TakiApplicationHashSchema.nullable(),
  completed_at: TakiApplicationTimeSchema.nullable(),
}).superRefine((value, context) => {
  if ((value.prompt_version === null) !== (value.prompt_hash === null)) {
    context.addIssue({ code: "custom", path: ["prompt_hash"], message: "prompt evidence must be a complete pair" });
  }
  if (value.state === "assessed") {
    if (value.attempts === 0 || value.prompt_version === null || value.prompt_hash === null || value.completed_at === null) {
      context.addIssue({ code: "custom", message: "assessed state requires actual model completion evidence" });
    }
    if (value.last_failure_code !== null || value.next_attempt_at !== null) {
      context.addIssue({ code: "custom", message: "assessed state cannot carry retry failure" });
    }
  } else if (value.completed_at !== null) {
    context.addIssue({ code: "custom", path: ["completed_at"], message: "unassessed state cannot claim model completion" });
  }
  if (value.state === "failed" && (value.attempts === 0 || value.last_failure_code === null || value.next_attempt_at === null)) {
    context.addIssue({ code: "custom", message: "failed assessment needs an attempt, failure and retry time" });
  }
  if (value.state === "not_required" && (value.attempts !== 0 || value.prompt_version !== null
    || value.prompt_hash !== null || value.last_failure_code !== null || value.next_attempt_at !== null)) {
    context.addIssue({ code: "custom", message: "unneeded assessment cannot fabricate model evidence" });
  }
  if (value.state === "due" && value.last_failure_code !== null) {
    context.addIssue({ code: "custom", path: ["last_failure_code"], message: "due assessment cannot carry a failed verdict" });
  }
});
export type TakiApplicationAssessment = z.infer<typeof TakiApplicationAssessmentSchema>;

export const TakiApplicationMemoryBodySchema = z.strictObject({
  policy_basis: TakiApplicationPolicyBasisSchema,
  policy: TakiMemoryPolicyProjectionSchema,
  assessment: TakiApplicationAssessmentSchema,
  provenance: MemoryProvenanceSchema,
  source_artifacts: z.array(TakiApplicationArtifactVersionSchema),
  original_record: HindsightCurrentCanonicalRecordSchema.nullable(),
  // Encoded witnesses belong to native JSON, whose strings may be larger than the original typed values.
  encoded_metadata: TakiApplicationJsonObjectSchema.nullable(),
});
export type TakiApplicationMemoryBody = z.infer<typeof TakiApplicationMemoryBodySchema>;
