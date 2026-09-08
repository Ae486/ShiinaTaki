/**
 * INPUT: Core boot handles, data directory, and Host identity
 * OUTPUT: composed desired repo, observed runtime manager, secret-aware catalog, and logger
 * POS: core/mcp composition seam; legacy seed runs only into an empty table after secret migration
 */
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Database } from "../db/sqlite.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { ExtensionChangeObserver } from "../extensions/notify-extension-change.ts";
import { join } from "node:path";
import { createMcpDesiredRepo, type McpDesiredRepo } from "./mcp-desired-repo.ts";
import { createLegacyMcpDenyReader } from "./legacy-mcp-deny.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";

export interface McpBoot {
  manager: McpManager;
  desired: McpDesiredRepo;
  /** Catalog mutations invalidate/reload exactly the generations referencing the changed secret. */
  catalog: SecretCatalogService;
  log: Logger;
}

export function bootMcpLifecycle(deps: {
  db: Database;
  dataDir: string;
  coreHostId: string;
  secretCatalog: SecretCatalogService;
  governance: GovernancePolicyService;
  approval: ApprovalInteractionService;
  logger: Logger;
  onChange?: ExtensionChangeObserver;
}): McpBoot {
  const log = deps.logger.child({ mod: "mcp" });
  const legacyMcpDeny = createLegacyMcpDenyReader({ filePath: join(deps.dataDir, "mcp-approvals.json"), logger: deps.logger });
  const desired = createMcpDesiredRepo(deps.db, { ownerHostId: deps.coreHostId });
  // Seed-only legacy input: imported once while the table is empty, strictly AFTER the secret migration rewrote
  // it to opaque refs (a still-plaintext file defers the seed — secret values never reach SQLite).
  desired.seedFromLegacyFile(join(deps.dataDir, "mcp-servers.json"), log, deps.onChange);
  const manager = createMcpManager({
    logger: deps.logger,
    onChange: deps.onChange,
    resolveSecret: (ref) => deps.secretCatalog.resolve(ref),
    governance: {
      service: deps.governance,
      ownerHostId: deps.coreHostId,
      approval: deps.approval,
      legacyDeny: (server, tool) => legacyMcpDeny.denies(server, tool),
    },
  });
  const catalog: SecretCatalogService = {
    ...deps.secretCatalog,
    set: (ref, value) => {
      const result = deps.secretCatalog.set(ref, value);
      manager.secretUpdated(ref);
      return result;
    },
    clear: (ref) => {
      const result = deps.secretCatalog.clear(ref);
      manager.secretCleared(ref);
      return result;
    },
  };
  return { manager, desired, catalog, log };
}
