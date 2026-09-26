/**
 * INPUT:  Core DB, the Core data dir, the live config source, the Secret Catalog with its owning host id, an optional native
 *         backup route and a Logger
 * OUTPUT: composeHindsightBackup() — the Stage 3 backup producer (capture/admit/verify) over the `<dataDir>/backups/` store,
 *         the production native route over the live Hindsight connection, custody and credential read-back from the Secret
 *         Catalog's presence only
 * POS:    core/boot — isolated backup composition; no boot filesystem or network effect here (the route reads the live
 *         connection per call)
 */
import type { ConfigSource } from "../config/config-source.ts";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { missingHindsightCredentials, readHindsightBackupCustody } from "../memory/hindsight-backup/hindsight-backup-custody.ts";
import { createHindsightNativeBackupRoute } from "../memory/hindsight-backup/hindsight-backup-native-route.ts";
import type { HindsightNativeBackupRoute } from "../memory/hindsight-backup/hindsight-backup-route.ts";
import { createHindsightBackupService, type HindsightBackupService } from "../memory/hindsight-backup/hindsight-backup-service.ts";
import { createHindsightBackupStore } from "../memory/hindsight-backup/hindsight-backup-store.ts";
import { createHindsightClient, type HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { readHindsightLiveProjection } from "../memory/hindsight/hindsight-runtime-connection.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";

export function composeHindsightBackup(input: {
  db: Database; dataDir: string; config: ConfigSource; secrets: { catalog: SecretCatalogService; storeId: string }; logger: Logger;
  /** Injected native route for isolated journey tests. */
  route?: HindsightNativeBackupRoute;
  /** Injected transport client for isolated journey tests; production always uses the common authenticated factory. */
  client?: HindsightClient;
}): HindsightBackupService {
  const logger = input.logger.child({ mod: "hindsight-backup" });
  return createHindsightBackupService({
    db: input.db,
    store: createHindsightBackupStore(input.dataDir),
    route: input.route ?? productionRoute(input, logger),
    custody: () => readHindsightBackupCustody(input.secrets),
    missingCredentials: (custody) => missingHindsightCredentials(custody, input.secrets.catalog),
    logger,
  });
}

function productionRoute(
  input: { config: ConfigSource; secrets: { catalog: SecretCatalogService }; client?: HindsightClient }, logger: Logger,
): HindsightNativeBackupRoute {
  const secret = createHindsightConnectionSecret(input.secrets.catalog);
  return createHindsightNativeBackupRoute({
    connection: () => readHindsightLiveProjection({ config: input.config, secrets: input.secrets.catalog }),
    client: (projection) => input.client ?? createHindsightClient({ endpoint: projection.endpoint, resolveApiKey: secret.resolve }),
    logger,
  });
}
