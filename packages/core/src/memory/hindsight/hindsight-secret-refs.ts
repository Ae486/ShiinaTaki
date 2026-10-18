/**
 * INPUT:  fixed Hindsight connection and managed-helper model credential slots
 * OUTPUT: stable Secret Catalog references plus a connection-only trusted resolver/fingerprint marker
 * POS:    core/memory/hindsight — Core resolves only the connection key; helper model refs remain opaque
 */
import { createHash } from "node:crypto";
import { HINDSIGHT_SECRET_REFS } from "@taki/shared/hindsight-custody";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";

export { HINDSIGHT_SECRET_REFS };

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
