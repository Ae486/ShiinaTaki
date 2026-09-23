/**
 * INPUT:  Core DB, the live config source and Secret Catalog, the B3 setup service, the composed memory runtime and a Logger
 * OUTPUT: composeHindsightActivation() — the Stage 2b activation service over the production client factory, the live
 *         connection fingerprint and the composition's Local/Hindsight binding seams
 * POS:    core/boot — isolated activation composition; no boot network call and no Memory Authority write happens here
 */
import type { ConfigSource } from "../config/config-source.ts";
import { resolveHindsightConfig } from "../config/hindsight-config.ts";
import type { PrimaryMemoryCustody } from "../db/primary-memory-custody-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { createHindsightClient, type HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { hindsightConnectionFingerprint } from "../memory/hindsight/hindsight-compatibility-service.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import type { HindsightSetupService } from "../memory/hindsight/hindsight-setup-service.ts";
import {
  createHindsightActivationService, type HindsightActivationLocalRuntime, type HindsightActivationRuntime, type HindsightActivationService,
} from "../memory/hindsight-activation/hindsight-activation-service.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";

export function composeHindsightActivation(input: {
  db: Database;
  config: ConfigSource;
  secrets: SecretCatalogService;
  setup: Pick<HindsightSetupService, "status">;
  runtime: HindsightActivationRuntime & { activationLocalRuntime(): HindsightActivationLocalRuntime; custody: Pick<PrimaryMemoryCustody, "status"> };
  logger: Logger;
  /** Injected transport client for isolated journey tests; production always uses the common authenticated factory. */
  client?: HindsightClient;
}): HindsightActivationService {
  const secret = createHindsightConnectionSecret(input.secrets);
  const connection = () => {
    const configured = resolveHindsightConfig(input.config);
    return configured.state === "ready" ? configured.projection : null;
  };
  return createHindsightActivationService({
    db: input.db,
    client: () => {
      const projection = connection();
      if (!projection) throw new Error("HINDSIGHT_CONNECTION_NOT_VERIFIED");
      return input.client ?? createHindsightClient({ endpoint: projection.endpoint, resolveApiKey: secret.resolve });
    },
    fingerprint: () => { const projection = connection(); return projection ? hindsightConnectionFingerprint(projection, secret.marker()) : null; },
    setup: input.setup,
    localRuntime: input.runtime.activationLocalRuntime,
    runtime: input.runtime,
    custody: input.runtime.custody,
    logger: input.logger.child({ mod: "hindsight-activation" }),
  });
}
