/**
 * INPUT:  Core DB/config/Secret Catalog plus the WS method registry and logger
 * OUTPUT: composeHindsightSetup() — inactive Hindsight B3 service and operator method registration
 * POS:    core/boot — isolated setup composition; no boot network calls, LLM health calls, or Memory Authority writes
 */
import type { ConfigSource } from "../config/config-source.ts";
import { resolveHindsightConfig } from "../config/hindsight-config.ts";
import { createHindsightBankSetupRepo } from "../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../db/hindsight-connection-repo.ts";
import { createHindsightCutoverRunRepo } from "../db/hindsight-cutover-run-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { createHindsightCompatibilityService } from "../memory/hindsight/hindsight-compatibility-service.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import { createHindsightSetupService, type HindsightSetupService } from "../memory/hindsight/hindsight-setup-service.ts";
import { readMemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import { registerHindsightSetupMethods } from "../server/methods/hindsight-setup-methods.ts";
import { registerHindsightCutoverMethods } from "../server/methods/hindsight-cutover-methods.ts";

export function composeHindsightSetup(input: {
  db: Database;
  config: ConfigSource;
  secrets: SecretCatalogService;
  registry: MethodRegistry;
  logger: Logger;
}): HindsightSetupService {
  const secret = createHindsightConnectionSecret(input.secrets);
  const service = createHindsightSetupService({
    config: () => resolveHindsightConfig(input.config),
    secret,
    client: (connection) => createHindsightClient({ endpoint: connection.endpoint, resolveApiKey: secret.resolve }),
    compatibility: createHindsightCompatibilityService(),
    connectionRepo: createHindsightConnectionRepo(input.db),
    bankRepo: createHindsightBankSetupRepo(input.db),
    authorityMode: () => readMemoryAuthoritySelection(input.db).mode,
  });
  registerHindsightSetupMethods(input.registry, { service, logger: input.logger });
  registerHindsightCutoverMethods(input.registry, { repo: createHindsightCutoverRunRepo(input.db), logger: input.logger });
  return service;
}
