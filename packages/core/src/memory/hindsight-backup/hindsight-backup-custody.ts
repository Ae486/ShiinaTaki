/**
 * INPUT:  the Secret Catalog (presence/list only) and the owning Core host id; a recorded custody record at read-back
 * OUTPUT: readHindsightBackupCustody() — presence, health and provenance of every Hindsight secret ref (the fixed slots plus
 *         any other `memory.hindsight.` ref the catalog lists) and the connection marker, recorded into each manifest;
 *         missingHindsightCredentials() — the refs a record saw present that a catalog does not hold now
 * POS:    core/memory/hindsight-backup — presence only: no value, envelope or key ever leaves the catalog through here, and
 *         SecretCatalogService.backup() is never called
 */
import { HindsightCredentialCustodySchema, type HindsightCredentialCustody } from "@taki/shared";
import type { SecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { createHindsightConnectionSecret, HINDSIGHT_SECRET_REFS } from "../hindsight/hindsight-secret-refs.ts";

const HINDSIGHT_REF_PREFIX = "memory.hindsight.";
const MAX_REFS = 32;

export function readHindsightBackupCustody(input: { catalog: SecretCatalogService; storeId: string }): HindsightCredentialCustody {
  const fixed: string[] = Object.values(HINDSIGHT_SECRET_REFS);
  const listed = input.catalog.list().entries.map((entry) => entry.secretRef)
    .filter((ref) => ref.startsWith(HINDSIGHT_REF_PREFIX) && !fixed.includes(ref)).sort();
  const refs = [...fixed, ...listed].slice(0, MAX_REFS).map((ref) => {
    const presence = input.catalog.presence(ref);
    return { ref, present: presence.present, health: presence.health,
      keyVersion: presence.provenance?.keyVersion ?? null, updatedAt: presence.provenance?.updatedAt ?? null };
  });
  return HindsightCredentialCustodySchema.parse({ storeId: input.storeId, refs,
    connectionMarker: createHindsightConnectionSecret(input.catalog).marker() });
}

/** A restore target without one of these would run that Hindsight path unauthenticated; each is named, never skipped. */
export function missingHindsightCredentials(custody: HindsightCredentialCustody, catalog: Pick<SecretCatalogService, "presence">): string[] {
  return custody.refs.filter((ref) => ref.present && !catalog.presence(ref.ref).present).map((ref) => ref.ref);
}
