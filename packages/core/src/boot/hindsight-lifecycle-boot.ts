/**
 * INPUT:  Core DB, the live config source and Secret Catalog, the composed memory runtime (operations view, Hindsight binding
 *         snapshot, replace seam) and a Logger
 * OUTPUT: composeHindsightLifecycle() — the Stage 2c lifecycle service over the production client factory
 * POS:    core/boot — isolated lifecycle composition; no boot network call and no Memory Authority write happens here
 */
import type { ConfigSource } from "../config/config-source.ts";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { createHindsightClient, type HindsightClient } from "../memory/hindsight/hindsight-client.ts";
import { createHindsightConnectionSecret } from "../memory/hindsight/hindsight-secret-refs.ts";
import { createHindsightLifecycleService, type HindsightLifecycleService } from "../memory/hindsight-lifecycle/hindsight-lifecycle-service.ts";
import type { HindsightBindingSnapshot } from "../memory/hindsight-runtime-binding.ts";
import type { MemoryOperationsRuntime } from "../memory/operations/memory-operation-contract.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { HindsightTemplateLifecycleService } from "../memory/hindsight/template-lifecycle/template-lifecycle-service.ts";
import type { MemoryAuthorityVerification } from "../memory/runtime-authority-verification.ts";

export function composeHindsightLifecycle(input: {
  db: Database;
  config: ConfigSource;
  secrets: SecretCatalogService;
  runtime: {
    verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"];
    operations(): MemoryOperationsRuntime | null;
    hindsightBindingSnapshot(): HindsightBindingSnapshot;
    replaceHindsightBinding(epochId: string): Promise<void>;
  };
  logger: Logger;
  /** Injected transport client for isolated journey tests; production always uses the common authenticated factory. */
  client?: HindsightClient;
  templates?: HindsightTemplateLifecycleService;
}): HindsightLifecycleService {
  const secret = createHindsightConnectionSecret(input.secrets);
  return createHindsightLifecycleService({
    db: input.db,
    config: input.config,
    secrets: input.secrets,
    client: (projection) => input.client ?? createHindsightClient({ endpoint: projection.endpoint, resolveApiKey: secret.resolve }),
    runtime: input.runtime.operations,
    verifySelectedAuthority: input.runtime.verifySelectedAuthority,
    templates: input.templates,
    binding: input.runtime.hindsightBindingSnapshot,
    replaceBinding: input.runtime.replaceHindsightBinding,
    logger: input.logger.child({ mod: "hindsight-lifecycle" }),
    now: () => new Date().toISOString(),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}
