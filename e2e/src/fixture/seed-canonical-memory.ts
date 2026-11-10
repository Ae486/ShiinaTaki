/**
 * INPUT:  an isolated Core data directory, optional Blocks and historical migration ceiling before boot
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
  const migrationsUrl = pathToFileURL(join(CORE_DIR, "src", "db", "migrations", "index-list.ts")).href;
  const authorityUrl = pathToFileURL(join(CORE_DIR, "src", "db", "canonical-memory-authority-repo.ts")).href;
  const blocksUrl = pathToFileURL(join(CORE_DIR, "src", "db", "structured-memory-block-repo.ts")).href;
  const script = `
    const { openDatabase } = await import(${JSON.stringify(sqliteUrl)});
    const { MIGRATIONS } = await import(${JSON.stringify(migrationsUrl)});
    const { createCanonicalMemoryAuthorityRepo } = await import(${JSON.stringify(authorityUrl)});
    const { createStructuredMemoryBlockRepo } = await import(${JSON.stringify(blocksUrl)});
    const migrations = MIGRATIONS.filter((migration) => migration.version <= Number(process.argv[3]));
    const db = openDatabase({ path: process.argv[1], migrations });
    const now = "2026-08-25T00:00:00.000Z";
    const authority = createCanonicalMemoryAuthorityRepo(db);
    const epoch = authority.initializeLocalAuthority(now);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-character", scope: { kind: "character", characterId: "taki" }, name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='e2e-snapshot',activation_transaction_id='e2e-activation',updated_at=:now WHERE singleton=1").run({ epoch: epoch.epochId, now });
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
