/**
 * INPUT:  the Secret Catalog and the owning Core host id
 * OUTPUT: readHindsightBackupCustody() — presence, health and provenance of every Hindsight secret ref plus the connection
 *         marker, recorded into each manifest so a restore can name what the target host must still hold
 * POS:    core/memory/hindsight-backup — presence only: no value, envelope or key ever leaves the catalog through here
 */
import { HindsightCredentialCustodySchema, type HindsightCredentialCustody } from "@taki/shared";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { createHindsightConnectionSecret, HINDSIGHT_SECRET_REFS } from "../hindsight/hindsight-secret-refs.ts";

export function readHindsightBackupCustody(input: { catalog: SecretCatalogService; storeId: string }): HindsightCredentialCustody {
  const refs = Object.values(HINDSIGHT_SECRET_REFS).map((ref) => {
    const presence = input.catalog.presence(ref);
    return { ref, present: presence.present, health: presence.health,
      keyVersion: presence.provenance?.keyVersion ?? null, updatedAt: presence.provenance?.updatedAt ?? null };
  });
  return HindsightCredentialCustodySchema.parse({ storeId: input.storeId, refs,
    connectionMarker: createHindsightConnectionSecret(input.catalog).marker() });
}
