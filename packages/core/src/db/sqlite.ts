/**
 * INPUT:  a db file path (or ':memory:') + an ordered migration list
 * OUTPUT: openDatabase({path, migrations}) -> Database (exec/prepare/transaction/backupTo/close); toSafeInteger helper
 * POS:    core/db — the ONLY module importing node:sqlite; repos receive this wrapper, never DatabaseSync; no fs here
 *         (backupTo writes only the path its caller owns)
 */
import { backup, DatabaseSync, type StatementSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
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
  /**
   * Online page copy through this connection; resolves with the page count. Same-connection writes during the copy are
   * reflected and rowids are kept (VACUUM INTO may renumber implicit rowids that Core orders by). An existing file at
   * `path` is overwritten, so the caller owns a fresh path and removes it on failure.
   */
  backupTo(path: string): Promise<number>;
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

/** Inspect a completed immutable backup only; never use this for a live database with a WAL. */
export function openReadonlyDatabase(path: string): Database {
  // SQLite's immutable URI avoids creating WAL/SHM sidecars beside a sealed WAL-mode backup. Read-only alone
  // still creates them, and a live database would require its WAL rather than this standalone-file contract.
  const uri = pathToFileURL(path); uri.searchParams.set("immutable", "1");
  return wrap(new DatabaseSync(uri.href, { readOnly: true }));
}

function wrap(raw: DatabaseSync): Database {
  let closed = false;
  const transactionState = { depth: 0 };
  const assertActive = () => assertActiveTransaction(raw, transactionState.depth);
  return {
    exec(sql) {
      assertActive();
      raw.exec(sql);
    },
    prepare(sql) {
      assertActive();
      return wrapStatement(raw.prepare(sql), assertActive);
    },
    transaction: (fn) => runTransaction(raw, transactionState, fn),
    backupTo: async (path) => {
      // A copy started inside a synchronous transaction outlives its callback, so no single committed state would bound it.
      if (transactionState.depth > 0) throw new Error("sqlite backup cannot start inside a transaction");
      return backup(raw, path);
    },
    // Idempotent: shutdown and test teardown may both close; node:sqlite throws on a double raw close.
    close() {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

function runTransaction(raw: DatabaseSync, state: { depth: number }, fn: () => void): void {
  assertActiveTransaction(raw, state.depth);
  const parentDepth = state.depth;
  const savepoint = `taki_nested_${parentDepth}`;
  raw.exec(parentDepth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
  state.depth = parentDepth + 1;
  try {
    fn();
    assertActiveTransaction(raw, state.depth);
    raw.exec(parentDepth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    // COMMIT can fail after fn succeeds. Keep its original boundary until rollback completes;
    // SQLite's ROLLBACK conflict action may already have ended the entire transaction.
    if (raw.isTransaction) {
      raw.exec(parentDepth === 0 ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${savepoint}`);
      if (parentDepth > 0) raw.exec(`RELEASE SAVEPOINT ${savepoint}`);
    }
    throw error;
  } finally {
    state.depth = parentDepth;
  }
}

function assertActiveTransaction(raw: DatabaseSync, depth: number): void {
  // A caught inner ROLLBACK must not let later statements autocommit while an outer callback
  // still believes it owns a transaction. Check prepared statements too, including RETURNING reads.
  if (depth > 0 && !raw.isTransaction) throw new Error("sqlite transaction was rolled back before its callback completed");
}

function wrapStatement(statement: StatementSync, assertActive: () => void): SqlStatement {
  return {
    run(params) {
      assertActive();
      const result = params ? statement.run(params) : statement.run();
      return {
        changes: toSafeInteger(result.changes),
        lastInsertRowid: toSafeInteger(result.lastInsertRowid),
      };
    },
    get(params) {
      assertActive();
      return params ? statement.get(params) : statement.get();
    },
    all(params) {
      assertActive();
      return params ? statement.all(params) : statement.all();
    },
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
