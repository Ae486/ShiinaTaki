/**
 * INPUT:  fixed Hindsight connection and managed-helper model credential slots
 * OUTPUT: stable Secret Catalog references plus a connection-only trusted resolver/fingerprint marker
 * POS:    core/memory/hindsight — Core resolves only the connection key; helper model refs remain opaque
 */
import { createHash } from "node:crypto";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";

export const HINDSIGHT_SECRET_REFS = {
  connectionApiKey: "memory.hindsight.connection.api-key",
  defaultModelApiKey: "memory.hindsight.model.default.api-key",
  retainModelApiKey: "memory.hindsight.model.retain.api-key",
  reflectModelApiKey: "memory.hindsight.model.reflect.api-key",
  consolidationModelApiKey: "memory.hindsight.model.consolidation.api-key",
  embeddingApiKey: "memory.hindsight.model.embedding.api-key",
  rerankerApiKey: "memory.hindsight.model.reranker.api-key",
} as const;

export function createHindsightConnectionSecret(catalog: SecretCatalogService) {
  return {
    resolve: (): string | null => catalog.resolve(HINDSIGHT_SECRET_REFS.connectionApiKey),
    marker: (): string => {
      const presence = catalog.presence(HINDSIGHT_SECRET_REFS.connectionApiKey);
      const safe = presence.provenance ? `${presence.provenance.keyVersion}:${presence.provenance.updatedAt}` : "none";
      return createHash("sha256").update(`${presence.health}:${presence.present}:${safe}`).digest("hex");
    },
    presence: () => catalog.presence(HINDSIGHT_SECRET_REFS.connectionApiKey),
  };
}
