/**
 * INPUT:  exact persisted application policy, verified native unit and current query/time
 * OUTPUT: deterministic read eligibility and a non-mutating consumer-only Taki layer-tag projection
 * POS:    core/memory/hindsight — exact addressed-record policy admission; derived dependency propagation remains D81
 */
import type { CanonicalMemoryUnit, TakiMemoryPolicyProjection } from "@taki/shared";
import { TakiApplicationTimeSchema } from "@taki/shared";
import { DEFAULT_INTENTIONS_DAYS } from "../../config/memory-config.ts";
import { disclosureMatches } from "../disclosure-gate.ts";
import type { MemoryLayerDefinition } from "../layer-registry.ts";
import { memoryRetentionVerdict } from "../retention-sweeper.ts";
import { requireSafeHindsightMemoryIngress } from "./hindsight-application-policy.ts";
import { projectHindsightApplicationPolicy, requireHindsightPolicyContext, requirePersistedHindsightPolicy,
  type HindsightPolicyContext, type PersistedHindsightMemoryPolicy } from "./hindsight-policy-context.ts";

export type HindsightPolicyAdmission = { eligible: true } | {
  eligible: false;
  reason: "invalidated" | "hidden" | "outside-layers" | "retention" | "mood-gated";
};

export function hindsightPolicyAdmission(input: {
  context: HindsightPolicyContext;
  state: PersistedHindsightMemoryPolicy;
  at: string;
  query: string;
  layerIds?: readonly string[];
}): HindsightPolicyAdmission {
  const context = requireHindsightPolicyContext(input.context);
  requirePersistedHindsightPolicy(context, input.state);
  const at = Date.parse(TakiApplicationTimeSchema.parse(input.at));
  const policy = projectHindsightApplicationPolicy(context, input.state);
  if (context.native.unit.state !== "valid") return { eligible: false, reason: "invalidated" };
  if (policy.visibility === "hidden") return { eligible: false, reason: "hidden" };
  if (input.layerIds && input.layerIds.length > 0 && !input.layerIds.includes(policy.layerId)) {
    return { eligible: false, reason: "outside-layers" };
  }
  if (!hindsightPolicyRetentionEligible({ unit: context.native.unit, policy, at })) return { eligible: false, reason: "retention" };
  if (policy.visibility === "mood-gated" && (!policy.disclosure?.trim() || !disclosureMatches(policy.disclosure, input.query))) {
    return { eligible: false, reason: "mood-gated" };
  }
  requireSafeHindsightMemoryIngress(context);
  return { eligible: true };
}

/** The same retention rule governs ordinary recall and completeness of required Run pins. */
export function hindsightPolicyRetentionEligible(input: {
  unit: CanonicalMemoryUnit; policy: TakiMemoryPolicyProjection; at: number;
}): boolean {
  const { unit, policy, at } = input;
  const row = { path: unit.memoryId, layer: policy.layerId, importance: policy.importance, createdAt: unit.createdAt,
    updatedAt: unit.updatedAt, expiresAt: policy.retention.kind === "expiring" ? policy.retention.expiresAt : null };
  return memoryRetentionVerdict(retentionRule(policy.retention), row,
    { at, intentionsDefaultDays: DEFAULT_INTENTIONS_DAYS }) === "keep";
}

/** Native evidence keeps its exact tags; only the Canonical consumer receives this policy-authorized layer tag. */
export function projectHindsightPolicyLayerTags(nativeTags: readonly string[], policy: TakiMemoryPolicyProjection): string[] {
  return [...nativeTags.filter((tag) => !tag.startsWith("taki-layer:")), `taki-layer:${policy.layerId}`];
}

function retentionRule(retention: TakiMemoryPolicyProjection["retention"]): MemoryLayerDefinition["retention"] {
  switch (retention.kind) {
    case "permanent": return "permanent";
    case "expiring": return "expiring";
    case "rolling-window": return { rollingDays: retention.days };
    case "importance-decay": return { archiveBelowImportance: retention.archiveBelowImportance, afterDays: retention.afterDays };
  }
}
