/**
 * INPUT:  Core DB, the Core data dir, the Secret Catalog with its owning host id, an optional native backup route and a Logger
 * OUTPUT: composeHindsightBackup() — the Stage 3 backup producer (capture/admit/verify) over the `<dataDir>/backups/` store,
 *         custody and credential read-back from the Secret Catalog's presence only
 * POS:    core/boot — isolated backup composition; without an injected route a route-c capture reports
 *         HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE (W5 supplies the real route); no boot filesystem or network effect here
 */
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { missingHindsightCredentials, readHindsightBackupCustody } from "../memory/hindsight-backup/hindsight-backup-custody.ts";
import { createUnavailableHindsightBackupRoute, type HindsightNativeBackupRoute } from "../memory/hindsight-backup/hindsight-backup-route.ts";
import { createHindsightBackupService, type HindsightBackupService } from "../memory/hindsight-backup/hindsight-backup-service.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";

export function composeHindsightBackup(input: {
  db: Database; dataDir: string; secrets: { catalog: SecretCatalogService; storeId: string }; logger: Logger;
  /** Injected native route for isolated journey tests. */
  route?: HindsightNativeBackupRoute;
}): HindsightBackupService {
  return createHindsightBackupService({
    db: input.db,
    store: createHindsightBackupStore(input.dataDir),
    route: input.route ?? createUnavailableHindsightBackupRoute(),
    custody: () => readHindsightBackupCustody(input.secrets),
    missingCredentials: (custody) => missingHindsightCredentials(custody, input.secrets.catalog),
    logger: input.logger.child({ mod: "hindsight-backup" }),
  });
}
