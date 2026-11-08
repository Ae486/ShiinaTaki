/**
 * INPUT:  Core configuration, Secret Catalog, original operation boot identity and controlled runtime seams
 * OUTPUT: one template lifecycle producer and operator status read from one verified SQLite snapshot
 * POS:    core/boot — execution remains owned by memory.operations; no automatic template application or recovery
 */
import type { ConfigSource } from "../config/config-source.ts";
import type { Database } from "../db/sqlite.ts";
import { createHindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import { createHindsightTemplateLifecycleService } from "../memory/hindsight/template-lifecycle/template-lifecycle-service.ts";
import { readTemplateStatus } from "../memory/hindsight/template-lifecycle/template-status.ts";
import type { TemplateRuntimeControl } from "../memory/hindsight/template-lifecycle/template-rollout.ts";
import type { MemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MethodRegistry } from "../server/method-registry.ts";
import { registerHindsightTemplateMethods } from "../server/methods/hindsight-template-methods.ts";

export function composeHindsightTemplates(input: {
  db: Database; config: ConfigSource; secrets: SecretCatalogService; registry: MethodRegistry;
  bootId: string; runtime: TemplateRuntimeControl;
  /** Operator status only; never passed into the template producer or its recovery/admission dependencies. */
  statusObservation?(): { selection: MemoryAuthoritySelection; boundSelectionIdentity: string | null };
}) {
  const secret = createHindsightConnectionSecret(input.secrets);
  const { statusObservation, ...producer } = input;
  const now = () => new Date().toISOString();
  const service = createHindsightTemplateLifecycleService({ ...producer, now,
    verifySelectedAuthority: input.runtime.verifySelectedAuthority,
    client: (projection) => createHindsightClient({ endpoint: projection.endpoint, resolveApiKey: secret.resolve }) });
  registerHindsightTemplateMethods(input.registry, { ...service, status: (params = {}) => {
    if (!statusObservation) return service.status(params);
    let status: ReturnType<typeof readTemplateStatus> | undefined;
    input.db.transaction(() => {
      const observed = statusObservation();
      status = readTemplateStatus({ ...producer, now, boundSelectionIdentity: () => observed.boundSelectionIdentity },
        params, observed.selection);
    });
    if (!status) throw new Error("MEMORY_TEMPLATE_EVIDENCE_INVALID");
    return status;
  } });
  return service;
}
