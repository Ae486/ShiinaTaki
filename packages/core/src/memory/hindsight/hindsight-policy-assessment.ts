/**
 * INPUT:  persisted policy and exact native/artifact CAS targets, plus actual assessment outcomes
 * OUTPUT: immutable rebind, assessment-success and retry proposals for the application repository
 * POS:    core/memory/hindsight — pure policy work; proposals gain authority only after repository CAS commits
 */
import { TakiApplicationAssessmentSchema, TakiApplicationArtifactVersionSchema, TakiApplicationMemoryBodySchema, TakiApplicationNativeVersionSchema,
  TakiMemoryPolicyProjectionSchema, type TakiApplicationArtifactVersion, type TakiApplicationAssessmentFailure,
  type TakiApplicationMemoryBody, type TakiApplicationNativeVersion, type TakiMemoryPolicyProjection } from "@taki/shared";
import { getLayer } from "../layer-registry.ts";
import { isPinnedEligible } from "../pinned-block.ts";
import { HindsightPolicyRefusal, requireHindsightPolicyContext, requireHindsightPolicyOwnership,
  requireHindsightPolicyEvidence, requirePersistedHindsightPolicy, sameHindsightNativeVersion, sameHindsightPolicyNamespace,
  type HindsightPolicyContext, type PersistedHindsightMemoryPolicy } from "./hindsight-policy-context.ts";

export interface HindsightPolicyAssessmentTarget {
  context: HindsightPolicyContext;
  state: PersistedHindsightMemoryPolicy;
  expectedNative: TakiApplicationNativeVersion;
  expectedArtifact: TakiApplicationArtifactVersion;
  expectedPolicyVersion: number;
}

export interface HindsightAssessmentPromptEvidence {
  promptVersion: string;
  promptHash: string;
}

export type HindsightAssessedPolicyFields = Pick<TakiMemoryPolicyProjection,
  "layerId" | "importance" | "visibility" | "disclosure" | "emotionalWeight" | "retention">;
const AssessedPolicyFieldsSchema = TakiMemoryPolicyProjectionSchema.pick({ layerId: true, importance: true,
  visibility: true, disclosure: true, emotionalWeight: true, retention: true });

/** Native evolution preserves every Taki restriction and its original policy revision/timestamp. */
export function rebindHindsightApplicationPolicy(input: {
  previous: { context: HindsightPolicyContext; state: PersistedHindsightMemoryPolicy };
  current: HindsightPolicyContext;
  expectedArtifact: TakiApplicationArtifactVersion;
}): TakiApplicationMemoryBody {
  const previous = requireHindsightPolicyContext(input.previous.context);
  const current = requireHindsightPolicyContext(input.current);
  requirePersistedHindsightPolicy(previous, input.previous.state);
  if (previous.bank.scope.kind !== current.bank.scope.kind
    || previous.bank.scope.characterId !== current.bank.scope.characterId) throw new HindsightPolicyRefusal("namespace_mismatch");
  return rebindHindsightApplicationPolicyEvidence({ previous: input.previous.state, current,
    expectedArtifact: input.expectedArtifact });
}

/** Only an exact, previously validated artifact/target is needed; no historic native body or made-up unit is required. */
export function rebindHindsightApplicationPolicyEvidence(input: {
  previous: PersistedHindsightMemoryPolicy;
  current: HindsightPolicyContext;
  expectedArtifact: TakiApplicationArtifactVersion;
}): TakiApplicationMemoryBody {
  const current = requireHindsightPolicyContext(input.current);
  const persisted = requireHindsightPolicyEvidence(input.previous);
  requireArtifactVersion(persisted.artifact, input.expectedArtifact);
  if (!sameHindsightPolicyNamespace(input.previous.namespace, current.namespace)
    || input.previous.bankId !== current.bank.bankId) throw new HindsightPolicyRefusal("namespace_mismatch");
  if (input.previous.native.object_id !== current.native.native.object_id
    || input.previous.native.object_kind !== current.native.native.object_kind
    || current.native.native.object_revision <= input.previous.native.object_revision) {
    throw new HindsightPolicyRefusal("native_version_conflict");
  }
  requireHindsightPolicyOwnership(current, persisted.body.policy);
  // The former model assessment remains in the immutable previous artifact. Its completion never certifies new text.
  return TakiApplicationMemoryBodySchema.parse({ ...persisted.body,
    assessment: { state: "due", target: current.native.native, attempts: 0, next_attempt_at: null,
      last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null } });
}

export function proposeHindsightPolicyAssessment(input: HindsightPolicyAssessmentTarget & {
  policy: HindsightAssessedPolicyFields;
  intent: "automatic" | "deliberate";
  prompt: HindsightAssessmentPromptEvidence;
  completedAt: string;
}): TakiApplicationMemoryBody {
  const { context, body } = requireAssessmentTarget(input);
  const policy = TakiMemoryPolicyProjectionSchema.parse({ ...body.policy, ...AssessedPolicyFieldsSchema.parse(input.policy),
    policyVersion: body.policy.policyVersion + 1, updatedAt: input.completedAt });
  requireHindsightPolicyOwnership(context, policy);
  requirePermittedPolicyAssessment(body.policy, policy, input.intent);
  const assessment = TakiApplicationAssessmentSchema.parse({ state: "assessed", target: context.native.native,
    attempts: body.assessment.attempts + 1, next_attempt_at: null, last_failure_code: null,
    prompt_version: input.prompt.promptVersion, prompt_hash: input.prompt.promptHash, completed_at: input.completedAt });
  return TakiApplicationMemoryBodySchema.parse({ ...body, policy_basis: "curated", policy, assessment });
}

export function proposeHindsightPolicyFailure(input: HindsightPolicyAssessmentTarget & {
  failure: TakiApplicationAssessmentFailure;
  nextAttemptAt: string;
  /** Null means no model was admitted; it must not create fictional prompt evidence. */
  prompt: HindsightAssessmentPromptEvidence | null;
}): TakiApplicationMemoryBody {
  const { context, body } = requireAssessmentTarget(input);
  const assessment = TakiApplicationAssessmentSchema.parse({ state: "failed", target: context.native.native,
    attempts: body.assessment.attempts + 1, next_attempt_at: input.nextAttemptAt, last_failure_code: input.failure,
    prompt_version: input.prompt?.promptVersion ?? null, prompt_hash: input.prompt?.promptHash ?? null, completed_at: null });
  // Native confirmation, policy identity and Pending disposition are untouched by a model failure.
  return TakiApplicationMemoryBodySchema.parse({ ...body, assessment });
}

function requireAssessmentTarget(input: HindsightPolicyAssessmentTarget) {
  const context = requireHindsightPolicyContext(input.context);
  const persisted = requirePersistedHindsightPolicy(context, input.state);
  requireArtifactVersion(persisted.artifact, input.expectedArtifact);
  const expected = TakiApplicationNativeVersionSchema.safeParse(input.expectedNative);
  if (!expected.success || !sameHindsightNativeVersion(context.native.native, expected.data)) {
    throw new HindsightPolicyRefusal("native_version_conflict");
  }
  if (persisted.body.policy.policyVersion !== input.expectedPolicyVersion) throw new HindsightPolicyRefusal("artifact_conflict");
  if (persisted.body.assessment.state !== "due" && persisted.body.assessment.state !== "failed") {
    throw new HindsightPolicyRefusal("policy_context_invalid");
  }
  return { context, body: persisted.body };
}

function requireArtifactVersion(current: TakiApplicationArtifactVersion, expected: TakiApplicationArtifactVersion): void {
  const parsed = TakiApplicationArtifactVersionSchema.safeParse(expected);
  if (!parsed.success || current.key.artifact_kind !== parsed.data.key.artifact_kind
    || current.key.artifact_id !== parsed.data.key.artifact_id || current.revision !== parsed.data.revision
    || current.record_hash !== parsed.data.record_hash) throw new HindsightPolicyRefusal("artifact_conflict");
}

function requirePermittedPolicyAssessment(previous: TakiMemoryPolicyProjection, policy: TakiMemoryPolicyProjection,
  intent: "automatic" | "deliberate"): void {
  if (intent !== "automatic" && intent !== "deliberate") throw new HindsightPolicyRefusal("policy_context_invalid");
  const layer = getLayer(policy.layerId);
  if (policy.layerId === "unclassified" || !layer) throw new HindsightPolicyRefusal("policy_context_invalid");
  const pins = policy.visibility === "pinned" || layer.recallPolicy === "pinned"
    || layer.pinnedImportanceThreshold !== undefined && policy.importance >= layer.pinnedImportanceThreshold;
  const preservesPin = previous.layerId === policy.layerId && previous.visibility === policy.visibility
    && policy.importance <= previous.importance && isPinnedEligible({ layer: previous.layerId,
      importance: previous.importance, visibility: previous.visibility });
  if (intent !== "deliberate" && (pins && !preservesPin || previous.visibility === "hidden" && policy.visibility !== "hidden")) {
    throw new HindsightPolicyRefusal("policy_context_invalid");
  }
  if (policy.visibility === "mood-gated" && !policy.disclosure?.trim()) throw new HindsightPolicyRefusal("policy_context_invalid");
}
