/**
 * INPUT:  an isolated Core data directory, optional Blocks and explicit T4 historical ceiling before boot
 * OUTPUT: seedCanonicalLocal(dataDir) — selected-schema DB with an active empty canonical Local authority and two banks
 * POS:    e2e/fixture — shared pre-boot canonical-memory baseline; runs sequentially before the Core writer starts
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_DIR } from "./paths.ts";

export function seedCanonicalLocal(dataDir: string, blocks: { globalUserCard?: string; characterIndex?: string } = {},
  throughMigration: number = Number.MAX_SAFE_INTEGER): void {
  const sqliteUrl = pathToFileURL(join(CORE_DIR, "src", "db", "sqlite.ts")).href;
  const historical = throughMigration !== Number.MAX_SAFE_INTEGER;
  const migrationsUrl = pathToFileURL(join(CORE_DIR, "src", "db", "migrations", historical ? "historical-t4.ts" : "index-list.ts")).href;
  const authorityUrl = pathToFileURL(join(CORE_DIR, "src", "db", "canonical-memory-authority-repo.ts")).href;
  const blocksUrl = pathToFileURL(join(CORE_DIR, "src", "db", "structured-memory-block-repo.ts")).href;
  const activationUrl = pathToFileURL(join(CORE_DIR, "src", "memory", "runtime-local-activation-test-fixture.ts")).href;
  const script = `
    const { openDatabase } = await import(${JSON.stringify(sqliteUrl)});
    const registry = await import(${JSON.stringify(migrationsUrl)});
    const { createCanonicalMemoryAuthorityRepo } = await import(${JSON.stringify(authorityUrl)});
    const { createStructuredMemoryBlockRepo } = await import(${JSON.stringify(blocksUrl)});
    const { activateLocalRuntimeFixture } = await import(${JSON.stringify(activationUrl)});
    const migrations = registry.${historical ? "T4_HISTORICAL_MIGRATIONS" : "MIGRATIONS"}.filter((migration) => migration.version <= Number(process.argv[3]));
    const db = openDatabase({ path: process.argv[1], migrations });
    const now = "2026-08-25T00:00:00.000Z";
    const authority = createCanonicalMemoryAuthorityRepo(db);
    const epoch = authority.initializeLocalAuthority(now);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-character", scope: { kind: "character", characterId: "taki" }, name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    // Synthetic engineering fixture: join the current guard's receipt/run/marker
    // identities; this does not claim an actual import or owner activation.
    activateLocalRuntimeFixture(db, epoch.epochId, { runId: "e2e-run", snapshotId: "e2e-snapshot", transactionId: "e2e-activation", at: now });
    const blocks = JSON.parse(process.argv[2]);
    const store = createStructuredMemoryBlockRepo(db);
    if (blocks.globalUserCard) store.replace({ blockId: "user-card", scope: { kind: "global", characterId: null }, actor: "user", content: blocks.globalUserCard });
    if (blocks.characterIndex) store.replace({ blockId: "memory-index", scope: { kind: "character", characterId: "taki" }, actor: "background", content: blocks.characterIndex });
    db.close();
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dataDir, "taki.db"), JSON.stringify(blocks), String(throughMigration)], {
    cwd: join(CORE_DIR, "..", ".."),
    stdio: "pipe",
  });
}
