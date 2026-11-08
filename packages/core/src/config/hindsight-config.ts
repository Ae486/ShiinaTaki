/**
 * INPUT:  the sparse ConfigSource effective view for TAKI_HINDSIGHT_* rows
 * OUTPUT: resolveHindsightConfig() -> disabled, unconfigured, or validated non-secret connection projection
 * POS:    core/config — env > stored > default projection; API-key values remain in the Secret Catalog
 */
import { HindsightConnectionProjectionSchema, type HindsightConnectionProjection } from "@taki/shared";
import { HINDSIGHT_SECRET_REFS } from "@taki/shared/hindsight-custody";
import type { ConfigSource } from "./config-source.ts";

export type HindsightResolvedConfig =
  | { state: "disabled"; projection: null }
  | { state: "unconfigured"; projection: null }
  | { state: "ready"; projection: HindsightConnectionProjection };

export function resolveHindsightConfig(source: ConfigSource): HindsightResolvedConfig {
  if (value(source, "TAKI_HINDSIGHT_ENABLED") !== true) return { state: "disabled", projection: null };
  const endpoint = value(source, "TAKI_HINDSIGHT_ENDPOINT");
  if (typeof endpoint !== "string" || endpoint.length === 0) return { state: "unconfigured", projection: null };
  const projection = HindsightConnectionProjectionSchema.parse({
    enabled: true,
    deploymentMode: value(source, "TAKI_HINDSIGHT_DEPLOYMENT_MODE"),
    endpoint,
    apiKeySecretRef: HINDSIGHT_SECRET_REFS.connectionApiKey,
    requestTimeoutMs: value(source, "TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS"),
    setupTimeoutMs: value(source, "TAKI_HINDSIGHT_SETUP_TIMEOUT_MS"),
    desiredTemplateRevision: value(source, "TAKI_HINDSIGHT_TEMPLATE_REVISION"),
    model: {
      defaultProvider: value(source, "TAKI_HINDSIGHT_MODEL_DEFAULT_PROVIDER"),
      defaultModel: value(source, "TAKI_HINDSIGHT_MODEL_DEFAULT"),
      retainModel: value(source, "TAKI_HINDSIGHT_MODEL_RETAIN"),
      reflectModel: value(source, "TAKI_HINDSIGHT_MODEL_REFLECT"),
      consolidationModel: value(source, "TAKI_HINDSIGHT_MODEL_CONSOLIDATION"),
      embeddingProvider: value(source, "TAKI_HINDSIGHT_EMBEDDING_PROVIDER"),
      embeddingModel: value(source, "TAKI_HINDSIGHT_EMBEDDING_MODEL"),
      rerankerProvider: value(source, "TAKI_HINDSIGHT_RERANKER_PROVIDER"),
      rerankerModel: value(source, "TAKI_HINDSIGHT_RERANKER_MODEL"),
    },
  });
  return { state: "ready", projection };
}

function value(source: ConfigSource, key: string) {
  return source.resolve(key)?.value ?? null;
}
