/**
 * INPUT:  a db file path (or ':memory:') + an ordered migration list
 * OUTPUT: openDatabase({path, migrations}) -> Database (exec/prepare/transaction/close); toSafeInteger helper
 * POS:    core/db — the ONLY module importing node:sqlite; repos receive this wrapper, never DatabaseSync; no fs here
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { runMigrations, type Migration } from "./migration-runner.ts";

/** Values SQLite binds or returns (subset of node:sqlite SQLInputValue / SQLOutputValue we use). */
export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqlStatement {
  run(params?: SqlRow): RunResult;
  get(params?: SqlRow): SqlRow | undefined;
  all(params?: SqlRow): SqlRow[];
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** BEGIN/COMMIT around fn, ROLLBACK on throw. Synchronous only — never await inside fn. */
  transaction(fn: () => void): void;
  close(): void;
}

export interface OpenDatabaseOptions {
  path: string;
  migrations: Migration[];
  /** Reports which versions were applied this boot (empty when already up to date); main logs it. */
  onMigrated?: (applied: number[]) => void;
}

export function openDatabase(options: OpenDatabaseOptions): Database {
  const raw = new DatabaseSync(options.path);
  // WAL gives the single-writer core non-blocking readers (no-op on :memory:); FKs default on, set for clarity.
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  const db = wrap(raw);
  const applied = runMigrations(db, options.migrations);
  options.onMigrated?.(applied);
  return db;
}

function wrap(raw: DatabaseSync): Database {
  let closed = false;
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => wrapStatement(raw.prepare(sql)),
    transaction(fn) {
      raw.exec("BEGIN");
      try {
        fn();
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
    // Idempotent: shutdown and test teardown may both close; node:sqlite throws on a double raw close.
    close() {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

function wrapStatement(statement: StatementSync): SqlStatement {
  return {
    run(params) {
      const result = params ? statement.run(params) : statement.run();
      return {
        changes: toSafeInteger(result.changes),
        lastInsertRowid: toSafeInteger(result.lastInsertRowid),
      };
    },
    get: (params) => (params ? statement.get(params) : statement.get()),
    all: (params) => (params ? statement.all(params) : statement.all()),
  };
}

/**
 * node:sqlite reads INTEGER as a JS number but widens to bigint past 2^53. Coerce to number,
 * refusing values that would silently lose precision (rowids won't reach this for ages).
 */
export function toSafeInteger(value: number | bigint): number {
  if (typeof value === "number") return value;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`sqlite integer ${value} exceeds MAX_SAFE_INTEGER`);
  }
  return Number(value);
}
