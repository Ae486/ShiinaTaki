/**
 * INPUT:  a Database wrapper + an ordered [{version, sql}] list (versions ascending)
 * OUTPUT: runMigrations(db, migrations) -> the versions applied this run; one transaction each, tracked
 * POS:    core/db — startup migration runner; TS-constant migrations (no fs); receives the wrapper (no node:sqlite here)
 */
import type { Database, SqlStatement } from "./sqlite.ts";

export interface Migration {
  version: number;
  sql: string;
}

export function runMigrations(db: Database, migrations: Migration[]): number[] {
  db.exec("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT");
  const current = currentVersion(db);
  const record = db.prepare("INSERT INTO migrations (version, applied_at) VALUES (:version, :applied_at)");
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    applyMigration(db, record, migration);
    applied.push(migration.version);
  }
  return applied;
}

function currentVersion(db: Database): number {
  const version = db.prepare("SELECT max(version) AS version FROM migrations").get()?.version;
  return typeof version === "number" ? version : 0;
}

function applyMigration(db: Database, record: SqlStatement, migration: Migration): void {
  try {
    db.transaction(() => {
      db.exec(migration.sql);
      record.run({ version: migration.version, applied_at: new Date().toISOString() });
    });
  } catch (error) {
    // Fatal-fast at boot with a precise message; the transaction has already rolled back.
    throw new Error(`migration ${migration.version} failed`, { cause: error });
  }
}
