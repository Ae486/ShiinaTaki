/**
 * INPUT:  non-secret desired model settings and a current validated API observation
 * OUTPUT: per-field comparisons with explicit unknown and no-preference outcomes
 * POS:    core/memory/hindsight — pure presentation projection, independent of health and authority readiness
 */
import { HindsightObservedModelIdentifierSchema, type HindsightConfigurationComparison,
  type HindsightConfigurationObservation, type HindsightModelProjection } from "@taki/shared";

export function compareHindsightConfiguration(desired: HindsightModelProjection | null,
  observation: HindsightConfigurationObservation | null): HindsightConfigurationComparison {
  const profiles = observation?.profiles;
  return {
    defaultProvider: compare(desired?.defaultProvider, profiles?.default.kind === "single" ? profiles.default.provider : undefined),
    defaultModel: compare(desired?.defaultModel, profiles?.default.kind === "single" ? profiles.default.configuredModel : undefined),
    retainModel: compare(desired?.retainModel, profiles?.retain.kind === "single" ? profiles.retain.configuredModel : undefined),
    reflectModel: compare(desired?.reflectModel, profiles?.reflect.kind === "single" ? profiles.reflect.configuredModel : undefined),
    consolidationModel: compare(desired?.consolidationModel, profiles?.consolidation.kind === "single" ? profiles.consolidation.configuredModel : undefined),
    embeddingProvider: compare(desired?.embeddingProvider, undefined), embeddingModel: compare(desired?.embeddingModel, undefined),
    rerankerProvider: compare(desired?.rerankerProvider, undefined), rerankerModel: compare(desired?.rerankerModel, undefined),
  };
}

function compare(desired: string | null | undefined, observed: string | undefined): HindsightConfigurationComparison["defaultModel"] {
  if (desired == null) return "not_requested";
  if (observed === undefined || !HindsightObservedModelIdentifierSchema.safeParse(desired).success) return "unknown";
  return desired === observed ? "match" : "mismatch";
}

/** Config contains operator hints, but this projection also excludes accidental URI/path/control strings. */
export function safeHindsightDesiredConfiguration(desired: HindsightModelProjection | undefined): HindsightModelProjection | null {
  if (!desired) return null;
  return Object.fromEntries(Object.entries(desired).map(([key, value]) => [key,
    value === null || HindsightObservedModelIdentifierSchema.safeParse(value).success ? value : null])) as HindsightModelProjection;
}
