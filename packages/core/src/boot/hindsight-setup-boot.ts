/**
 * INPUT:  Core DB/config/Secret Catalog plus the WS method registry and logger
 * OUTPUT: composeHindsightSetup() — inactive Hindsight B3 service and operator method registration, after interrupted-attempt reconciliation
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
import { reconcileInterruptedSetup } from "../memory/hindsight/hindsight-setup-recovery.ts";
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
  const connectionRepo = createHindsightConnectionRepo(input.db);
  const bankRepo = createHindsightBankSetupRepo(input.db);
  // A busy phase left by a dead process can never complete; reconcile before any operator request can observe it.
  const interrupted = reconcileInterruptedSetup({ connectionRepo, bankRepo }, () => new Date().toISOString());
  if (interrupted) input.logger.child({ mod: "hindsight-setup" }).info(interrupted, "interrupted Hindsight setup attempt reconciled to failed");
  const service = createHindsightSetupService({
    config: () => resolveHindsightConfig(input.config),
    secret,
    client: (connection) => createHindsightClient({ endpoint: connection.endpoint, resolveApiKey: secret.resolve }),
    compatibility: createHindsightCompatibilityService(),
    connectionRepo,
    bankRepo,
    authorityMode: () => readMemoryAuthoritySelection(input.db).mode,
  });
  registerHindsightSetupMethods(input.registry, { service, logger: input.logger });
  registerHindsightCutoverMethods(input.registry, { repo: createHindsightCutoverRunRepo(input.db), logger: input.logger });
  return service;
}
