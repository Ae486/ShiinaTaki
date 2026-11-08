/**
 * INPUT:  Core configuration revision, DB, Secret Catalog and authenticated method registry
 * OUTPUT: one shared optional configuration observation owner, registered without boot I/O
 * POS:    core/boot — composes read-only identity and transport seams, independent of setup/authority readiness
 */
import type { ConfigSource } from "../config/config-source.ts";
import type { Database } from "../db/sqlite.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { readHindsightConfigurationContext, type HindsightConfigurationCapture } from "../memory/hindsight/hindsight-configuration-context.ts";
import { createHindsightConfigurationService } from "../memory/hindsight/hindsight-configuration-service.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import type { MemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import { registerHindsightConfigurationMethods } from "../server/methods/hindsight-configuration-methods.ts";

export function composeHindsightConfiguration(input: {
  db: Database; config: ConfigSource; secrets: SecretCatalogService; registry: MethodRegistry;
  configurationRevision(): number;
  /** Operator status only; network observation retains independent captures on both sides of its await. */
  statusSelection?(): MemoryAuthoritySelection;
}) {
  const secret = createHindsightConnectionSecret(input.secrets);
  const { statusSelection, ...producer } = input;
  const deps = { ...producer, secret, secretRevision: input.secrets.revision };
  const service = createHindsightConfigurationService({
    read: (scope) => readHindsightConfigurationContext(deps, scope),
    client: (capture) => createHindsightClient({ endpoint: capture.connection.endpoint, resolveApiKey: secret.resolve }),
  });
  registerHindsightConfigurationMethods(input.registry, { ...service, status: (params) => {
    if (!statusSelection) return service.status(params);
    let current: HindsightConfigurationCapture | null = null;
    try {
      input.db.transaction(() => { current = readHindsightConfigurationContext(deps, params.scope, statusSelection()); });
    } catch { /* Match the ordinary capture's unavailable result without exposing raw configuration errors. */ }
    return service.status(params, current);
  } });
  return service;
}
