/**
 * INPUT:  a db file path (or ':memory:') + an ordered migration list
 * OUTPUT: Database with SQL/transaction/after-commit/backup operations and read-only transaction state
 * POS:    core/db — the ONLY module importing node:sqlite; repos receive this wrapper, never DatabaseSync; no fs here
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
  /** Actual SQLite state, including transactions entered through exec(); false after close. */
  readonly isTransaction: boolean;
  /** Online rowid-preserving copy; the caller owns a fresh destination path. */
  backupTo(path: string): Promise<number>;
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** BEGIN/COMMIT around fn, ROLLBACK on throw. Synchronous only — never await inside fn. */
  transaction(fn: () => void): void;
  /** Process notifications only, after the outermost successful commit; rollback discards them. */
  afterCommit(callback: () => void): void;
  close(): void;
}

export interface OpenDatabaseOptions {
  path: string;
  migrations: Migration[];
  /** Reports which versions were applied this boot (empty when already up to date); main logs it. */
  onMigrated?: (applied: number[]) => void;
  onAfterCommitError?: (error: unknown) => void;
}

export function openDatabase(options: OpenDatabaseOptions): Database {
  const raw = new DatabaseSync(options.path);
  try {
    // WAL gives the single-writer core non-blocking readers (no-op on :memory:); FKs default on, set for clarity.
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA foreign_keys = ON");
    const db = wrap(raw, options.onAfterCommitError);
    const applied = runMigrations(db, options.migrations);
    options.onMigrated?.(applied);
    return db;
  } catch (error) {
    // A refused boot never transfers connection ownership to its caller. Release
    // the file immediately so a stopped-copy retry/cleanup cannot retain its lock.
    raw.close();
    throw error;
  }
}

/** Inspect a completed immutable backup only; never use this for a live database with a WAL. */
export function openReadonlyDatabase(path: string): Database {
  const uri = pathToFileURL(path); uri.searchParams.set("immutable", "1");
  return wrap(new DatabaseSync(uri.href, { readOnly: true }));
}

interface TransactionState {
  depth: number;
  frames: Array<Array<() => void>>;
  ready: Array<() => void>;
  draining: boolean;
  onError?: (error: unknown) => void;
}

function wrap(raw: DatabaseSync, onError?: (error: unknown) => void): Database {
  let closed = false;
  const transactionState: TransactionState = { depth: 0, frames: [], ready: [], draining: false, onError };
  const assertActive = () => assertActiveTransaction(raw, transactionState.depth);
  return {
    get isTransaction() { return raw.isOpen && raw.isTransaction; },
    backupTo: async (path) => {
      // A copy outlives this callback; a wrapper transaction cannot supply its committed boundary.
      if (transactionState.depth > 0) throw new Error("sqlite backup cannot start inside a transaction");
      return backup(raw, path);
    },
    exec(sql) {
      assertActive();
      raw.exec(sql);
    },
    prepare(sql) {
      assertActive();
      return wrapStatement(raw.prepare(sql), assertActive);
    },
    transaction: (fn) => runTransaction(raw, transactionState, fn),
    afterCommit(callback) {
      assertActive();
      const frame = transactionState.frames.at(-1);
      if (frame) { frame.push(callback); return; }
      if (raw.isTransaction) throw new Error("sqlite afterCommit requires wrapper-managed transactions");
      transactionState.ready.push(callback);
      drainCommitted(transactionState);
    },
    // Idempotent: shutdown and test teardown may both close; node:sqlite throws on a double raw close.
    close() {
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}

function runTransaction(raw: DatabaseSync, state: TransactionState, fn: () => void): void {
  assertActiveTransaction(raw, state.depth);
  const parentDepth = state.depth;
  const savepoint = `taki_nested_${parentDepth}`;
  raw.exec(parentDepth === 0 ? "BEGIN" : `SAVEPOINT ${savepoint}`);
  state.depth = parentDepth + 1;
  const callbacks: Array<() => void> = [];
  state.frames.push(callbacks);
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
    state.frames.pop();
  }
  const parent = state.frames.at(-1);
  if (parent) parent.push(...callbacks);
  else {
    state.ready.push(...callbacks);
    drainCommitted(state);
  }
}

function drainCommitted(state: TransactionState): void {
  if (state.draining) return;
  state.draining = true;
  try {
    while (state.ready.length > 0) {
      const callback = state.ready.shift();
      try { callback?.(); }
      catch (error) {
        try { state.onError?.(error); }
        catch { /* A diagnostic sink cannot prevent later committed cleanup. */ }
      }
    }
  } finally { state.draining = false; }
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
