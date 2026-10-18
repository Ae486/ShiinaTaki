/**
 * INPUT:  Core configuration, Secret Catalog, original operation boot identity and controlled runtime seams
 * OUTPUT: one template lifecycle producer and operator-only preview/status/child reads without boot network work
 * POS:    core/boot — execution remains owned by memory.operations; no automatic template application or recovery
 */
import type { ConfigSource } from "../config/config-source.ts";
import type { Database } from "../db/sqlite.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import { createHindsightTemplateLifecycleService } from "../memory/hindsight/template-lifecycle/template-lifecycle-service.ts";
import type { TemplateRuntimeControl } from "../memory/hindsight/template-lifecycle/template-rollout.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import { registerHindsightTemplateMethods } from "../server/methods/hindsight-template-methods.ts";

export function composeHindsightTemplates(input: {
  db: Database; config: ConfigSource; secrets: SecretCatalogService; registry: MethodRegistry;
  bootId: string; runtime: TemplateRuntimeControl;
}) {
  const secret = createHindsightConnectionSecret(input.secrets);
  const service = createHindsightTemplateLifecycleService({ ...input, now: () => new Date().toISOString(),
    client: (projection) => createHindsightClient({ endpoint: projection.endpoint, resolveApiKey: secret.resolve }) });
  registerHindsightTemplateMethods(input.registry, service);
  return service;
}
