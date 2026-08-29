/**
 * INPUT:  an isolated Core data directory before boot
 * OUTPUT: seedCanonicalLocal(dataDir) — migrated DB with an active empty canonical Local authority and two banks
 * POS:    e2e/fixture — shared pre-boot canonical-memory baseline; runs sequentially before the Core writer starts
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_DIR } from "./paths.ts";

export function seedCanonicalLocal(dataDir: string): void {
  const sqliteUrl = pathToFileURL(join(CORE_DIR, "src", "db", "sqlite.ts")).href;
  const migrationsUrl = pathToFileURL(join(CORE_DIR, "src", "db", "migrations", "index-list.ts")).href;
  const authorityUrl = pathToFileURL(join(CORE_DIR, "src", "db", "canonical-memory-authority-repo.ts")).href;
  const script = `
    const { openDatabase } = await import(${JSON.stringify(sqliteUrl)});
    const { MIGRATIONS } = await import(${JSON.stringify(migrationsUrl)});
    const { createCanonicalMemoryAuthorityRepo } = await import(${JSON.stringify(authorityUrl)});
    const db = openDatabase({ path: process.argv[1], migrations: MIGRATIONS });
    const now = "2026-08-25T00:00:00.000Z";
    const authority = createCanonicalMemoryAuthorityRepo(db);
    const epoch = authority.initializeLocalAuthority(now);
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-global", scope: { kind: "global", characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    authority.createBank({ authorityEpochId: epoch.epochId, bankId: "e2e-character", scope: { kind: "character", characterId: "taki" }, name: "Taki", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "e2e", config: {}, createdAt: now, updatedAt: now });
    db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id='e2e-snapshot',activation_transaction_id='e2e-activation',updated_at=:now WHERE singleton=1").run({ epoch: epoch.epochId, now });
    db.close();
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", script, join(dataDir, "taki.db")], {
    cwd: join(CORE_DIR, "..", ".."),
    stdio: "pipe",
  });
}
