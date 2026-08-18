/**
 * INPUT: Core database, data directory, owner Host identity, and Logger
 * OUTPUT: bootSkillLifecycle(...) with catalog-backed loader, service, and bounded seed diagnostics
 * POS:    core/skills composition seam; legacy directories seed once through the standard safe pipeline
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../db/sqlite.ts";
import type { Logger } from "../logging/logger.ts";
import { createSkillCatalogManager } from "./skill-catalog-manager.ts";
import { createSkillLifecycleService } from "./skill-lifecycle-service.ts";
import { createSkillPackageRepo, type SkillPackageRepo } from "./skill-package-repo.ts";
import { enumerateLegacyDirectory } from "./skill-package-source.ts";
import { publishSkill, validateSkillFiles } from "./skill-package-store.ts";
import { createSkillsLoader } from "./skills-loader.ts";
import { createSkillsState } from "./skills-state.ts";

interface SeedResult { imported: number; rejected: number; }

export async function bootSkillLifecycle(input: { db: Database; dataDir: string; ownerHostId: string; logger: Logger }) {
  const log = input.logger.child({ mod: "skills" }); const legacyRoot = join(input.dataDir, "skills");
  const state = createSkillsState({ filePath: join(input.dataDir, "skills-state.json"), logger: input.logger });
  const repo = createSkillPackageRepo(input.db, { ownerHostId: input.ownerHostId }); const storeRoot = join(input.dataDir, "skill-packages");
  const seed = repo.count() === 0 ? seedLegacy({ repo, legacyRoot, storeRoot, ownerHostId: input.ownerHostId, state }) : { imported: 0, rejected: 0 };
  const catalog = createSkillCatalogManager({ root: storeRoot }); const service = createSkillLifecycleService({ repo, catalog, storeRoot, ownerHostId: input.ownerHostId });
  const reconciled = await service.reconcile();
  log.info({ active: repo.list().filter((row) => row.lifecycleState === "active").length, invalidated: reconciled.invalidated, seeded: seed.imported, seedRejected: seed.rejected }, "skill lifecycle ready");
  return { service, catalog, log, loader: createSkillsLoader({ skills: [], state, catalog }) };
}

function seedLegacy(input: { repo: SkillPackageRepo; legacyRoot: string; storeRoot: string; ownerHostId: string; state: ReturnType<typeof createSkillsState> }): SeedResult {
  const result = { imported: 0, rejected: 0 };
  for (const directory of listLegacyDirectories(input.legacyRoot)) {
    try {
      const validated = validateSkillFiles(enumerateLegacyDirectory(join(input.legacyRoot, directory)), { expectedRootName: directory }); const packageId = randomUUID();
      publishSkill(input.storeRoot, packageId, validated);
      input.repo.insert({ packageId, skillName: validated.skillName, description: validated.description, ownerHostId: input.ownerHostId, contentHash: validated.hash, lifecycleState: "active", enabled: !input.state.isDisabled(validated.skillName), sourceKind: "legacy-directory", sourceLocator: "legacy-directory", trust: "legacy-local", scanVersion: "skill-scan-v1", scanVerdict: validated.findings.length ? "review" : "passed", scanFindings: validated.findings, failureReason: null });
      result.imported += 1;
    } catch {
      input.repo.insert({ skillName: null, description: null, ownerHostId: input.ownerHostId, contentHash: null, lifecycleState: "rejected", enabled: false, sourceKind: "legacy-directory", sourceLocator: "legacy-directory", trust: "blocked", scanVersion: "skill-scan-v1", scanVerdict: "rejected", scanFindings: [], failureReason: "legacy skill validation failed" });
      result.rejected += 1;
    }
  }
  return result;
}

function listLegacyDirectories(root: string): string[] {
  try { return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
