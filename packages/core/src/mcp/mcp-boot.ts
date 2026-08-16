/**
 * INPUT:  Core boot handles (db, secret catalog, governance service, Approval runtime, data dir, host identity)
 * OUTPUT: bootMcpLifecycle(...) -> { manager, desired, catalog, log } — composes the desired-state repo (with the
 *         legacy seed), the runtime generation manager, and the secret-clear-aware catalog view; the caller owns
 *         the non-blocking reconcile kick and the method registrations
 * POS:    core/mcp — the lifecycle's composition seam so main.ts stays a thin wiring root; boot order is pinned:
 *         the legacy mcp-servers.json seeds ONLY while the table is empty and ONLY AFTER the secret migration
 */
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import type { Database } from "../db/sqlite.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import { join } from "node:path";
import { createMcpDesiredRepo, type McpDesiredRepo } from "./mcp-desired-repo.ts";
import { createLegacyMcpDenyReader } from "./legacy-mcp-deny.ts";
import { createMcpManager, type McpManager } from "./mcp-manager.ts";

export interface McpBoot {
  manager: McpManager;
  desired: McpDesiredRepo;
  /** The catalog with one post-clear observer: a cleared secret retires exactly the generations referencing it. */
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
}): McpBoot {
  const log = deps.logger.child({ mod: "mcp" });
  const legacyMcpDeny = createLegacyMcpDenyReader({ filePath: join(deps.dataDir, "mcp-approvals.json"), logger: deps.logger });
  const desired = createMcpDesiredRepo(deps.db, { ownerHostId: deps.coreHostId });
  // Seed-only legacy input: imported once while the table is empty, strictly AFTER the secret migration rewrote
  // it to opaque refs (a still-plaintext file defers the seed — secret values never reach SQLite).
  desired.seedFromLegacyFile(join(deps.dataDir, "mcp-servers.json"), log);
  const manager = createMcpManager({
    logger: deps.logger,
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
    clear: (ref) => {
      const result = deps.secretCatalog.clear(ref);
      manager.secretCleared(ref);
      return result;
    },
  };
  return { manager, desired, catalog, log };
}
