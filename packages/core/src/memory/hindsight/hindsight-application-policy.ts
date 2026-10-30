/**
 * INPUT:  exact native/application evidence, trusted unit labels and repository-assigned insertion stamps
 * OUTPUT: preserved policy or a deterministic first-policy proposal that must be committed before exposure
 * POS:    core/memory/hindsight — Taki policy only; no database, model, native edit or Pending transition
 */
import { MemoryProvenanceSchema, TAKI_MEMORY_DEFAULT_IMPORTANCE, TakiApplicationMemoryBodySchema,
  TakiMemoryPolicyProjectionSchema, type CanonicalMemoryRecord, type JsonValue, type MemoryProvenance,
  type TakiApplicationArtifactVersion, type TakiApplicationMemoryBody, type TakiMemoryPolicyProjection } from "@taki/shared";
import { clampAutoImportance } from "../auto-layer-policy.ts";
import { isSafeAutomaticMemoryText } from "../canonical-ingestion-source.ts";
import { canonicalLayerRetention, requireLayerOwnership } from "../canonical-layer-policy.ts";
import { getLayer } from "../layer-registry.ts";
import { HindsightPolicyRefusal, projectHindsightApplicationPolicy, requireHindsightPolicyAddress,
  requireHindsightPolicyContext, requireHindsightPolicyOwnership, requirePersistedHindsightPolicy,
  type HindsightPolicyAddress, type HindsightPolicyContext, type HindsightPolicyLookup,
  type VerifiedHindsightPolicyContext } from "./hindsight-policy-context.ts";

export interface HindsightFirstPolicyStamp {
  policyVersion: number;
  updatedAt: string;
}
const FirstPolicyStampSchema = TakiMemoryPolicyProjectionSchema.pick({ policyVersion: true, updatedAt: true });

export type HindsightNewMemoryEvidence = { kind: "provider-derived"; observedAt: string }
  | (HindsightPolicyAddress & {
    kind: "verified-unit";
    provenance: MemoryProvenance;
    origin: TakiMemoryPolicyProjection["origin"];
    sourceArtifacts: TakiApplicationArtifactVersion[];
    originalRecord: CanonicalMemoryRecord | null;
    encodedMetadata: Record<string, JsonValue> | null;
  });

/** Trust is per unit and exact native version; a document-wide label is insufficient. */
export interface HindsightTrustedUnitLabel extends HindsightPolicyAddress {
  layerId: string;
  disclosure: string | null;
}

export interface HindsightPolicyResolutionInput {
  context: HindsightPolicyContext;
  state: HindsightPolicyLookup;
  /** Required only after authenticated absence; allocated by the repository's real insertion transaction. */
  initial?: { stamp: HindsightFirstPolicyStamp; evidence: HindsightNewMemoryEvidence; label?: HindsightTrustedUnitLabel };
}

export type HindsightPolicyResolution = {
  kind: "existing";
  body: TakiApplicationMemoryBody;
  artifact: TakiApplicationArtifactVersion;
  policy: TakiMemoryPolicyProjection;
} | { kind: "initialize"; body: TakiApplicationMemoryBody };

export function resolveHindsightApplicationPolicy(input: HindsightPolicyResolutionInput): HindsightPolicyResolution {
  const context = requireHindsightPolicyContext(input.context);
  if (input.state.status === "present") {
    const persisted = requirePersistedHindsightPolicy(context, input.state);
    return { kind: "existing", ...persisted, policy: projectHindsightApplicationPolicy(context, input.state) };
  }
  if (input.state.status !== "authenticated-absence") {
    throw new HindsightPolicyRefusal(input.state.status === "invalid" ? "application_state_corrupt" : "capture_required");
  }
  requireHindsightPolicyAddress(context, input.state);
  if (!input.initial) throw new HindsightPolicyRefusal("capture_required");
  if (context.native.unit.state !== "valid") throw new HindsightPolicyRefusal("policy_context_invalid");
  requireSafeHindsightMemoryIngress(context);
  return { kind: "initialize", body: initializeBody(context, input.initial) };
}

function initializeBody(context: VerifiedHindsightPolicyContext, initial: NonNullable<HindsightPolicyResolutionInput["initial"]>) {
  const stamp = FirstPolicyStampSchema.parse(initial.stamp);
  const evidence = memoryEvidence(context, initial.evidence);
  const preserved = evidence.original_record?.policy;
  const registry = initial.label && !preserved ? registryPolicy(context, initial.label, stamp) : null;
  const policy = preserved ?? registry ?? TakiMemoryPolicyProjectionSchema.parse({
    authorityEpochId: context.authorityEpochId, bankId: context.bank.bankId, memoryId: context.native.unit.memoryId,
    layerId: "unclassified", importance: TAKI_MEMORY_DEFAULT_IMPORTANCE, visibility: "retrieved", disclosure: null,
    origin: evidence.origin, emotionalWeight: null, retention: { kind: "permanent" }, ...stamp,
  });
  requireHindsightPolicyOwnership(context, policy);
  const basis = preserved ? "curated" : registry ? "registry" : "neutral";
  return TakiApplicationMemoryBodySchema.parse({ policy_basis: basis, policy: { ...policy, origin: evidence.origin },
    assessment: { state: basis === "neutral" ? "due" : "not_required", target: context.native.native,
      attempts: 0, next_attempt_at: null, last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null },
    provenance: evidence.provenance, source_artifacts: evidence.source_artifacts,
    original_record: evidence.original_record, encoded_metadata: evidence.encoded_metadata });
}

function memoryEvidence(context: VerifiedHindsightPolicyContext, evidence: HindsightNewMemoryEvidence) {
  if (evidence.kind === "provider-derived") return {
    origin: "observed" as const, original_record: null, encoded_metadata: null, source_artifacts: [],
    provenance: MemoryProvenanceSchema.parse({ actor: "provider", origin: "provider-derived",
      characterId: context.bank.scope.characterId, timelineFromSeq: null, timelineToSeq: null,
      capturedAt: evidence.observedAt, sanitized: true, sourceRef: nativeReference(context) }),
  };
  requireHindsightPolicyAddress(context, evidence);
  const provenance = MemoryProvenanceSchema.parse(evidence.provenance);
  // The evidence is unit-scoped. Source artifact provenance is a separate body and never substitutes for this one.
  if (evidence.originalRecord !== null
    && JSON.stringify(provenance) !== JSON.stringify(MemoryProvenanceSchema.parse(evidence.originalRecord.provenance))) {
    throw new HindsightPolicyRefusal("binding_invalid");
  }
  if (evidence.sourceArtifacts.some((artifact) => artifact.key.artifact_kind !== "source")) {
    throw new HindsightPolicyRefusal("source_reference_invalid");
  }
  return { origin: evidence.originalRecord?.policy.origin ?? evidence.origin, provenance,
    source_artifacts: evidence.sourceArtifacts, original_record: evidence.originalRecord, encoded_metadata: evidence.encodedMetadata };
}

function nativeReference(context: VerifiedHindsightPolicyContext): string {
  const version = context.native.native;
  // Bank generation scopes the actual object identity. No document, user turn or historic gate is invented.
  return `hindsight:${context.namespace.provider_lineage}:${context.namespace.bank_generation}:${version.object_kind}:${version.object_id}@${version.object_revision}`;
}

function registryPolicy(context: VerifiedHindsightPolicyContext, label: HindsightTrustedUnitLabel, stamp: HindsightFirstPolicyStamp) {
  requireHindsightPolicyAddress(context, label);
  const layer = getLayer(label.layerId);
  const tags = context.native.unit.tags.filter((tag) => tag.startsWith("taki-layer:"));
  if (!layer || tags.length !== 1 || tags[0] !== `taki-layer:${layer.id}` || layer.recallPolicy === "pinned") return null;
  if (layer.recallPolicy === "mood-gated" && !label.disclosure?.trim()) return null;
  try { requireLayerOwnership(context.bank, layer); } catch { return null; }
  return TakiMemoryPolicyProjectionSchema.parse({
    authorityEpochId: context.authorityEpochId, bankId: context.bank.bankId, memoryId: context.native.unit.memoryId,
    layerId: layer.id, importance: clampAutoImportance(layer.id, TAKI_MEMORY_DEFAULT_IMPORTANCE),
    visibility: layer.recallPolicy, disclosure: label.disclosure, origin: "observed", emotionalWeight: null,
    retention: canonicalLayerRetention({ layer, at: stamp.updatedAt }), ...stamp,
  });
}

export function requireSafeHindsightMemoryIngress(context: VerifiedHindsightPolicyContext): void {
  const { text, context: memoryContext } = context.native.unit;
  if (!isSafeAutomaticMemoryText(text) || memoryContext !== null && !isSafeAutomaticMemoryText(memoryContext)) {
    throw new HindsightPolicyRefusal("policy_context_invalid");
  }
}
