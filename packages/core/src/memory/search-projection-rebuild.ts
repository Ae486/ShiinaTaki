/**
 * INPUT: authoritative projection rows, single-writer SQLite, candidate tokenizer and authority guard
 * OUTPUT: bounded candidate-index preparation and atomic publication with concurrent-write reconciliation
 * POS: core/memory — derived maintenance producer; never replaces Memory authority or retained Run identity
 */
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import type { Database, SqlRow, SqlStatement } from "../db/sqlite.ts";
import type { SearchTokenizer } from "./search-tokenizer.ts";

export interface SearchProjectionRow { key: string; values: SqlRow; text: string }
export interface SearchProjectionSource {
  table: "memory_fts" | "canonical_memory_fts";
  columns: readonly string[];
  identities: readonly string[];
  tracked: ReadonlyArray<{ table: string; columns: readonly string[] }>;
  scan(): AsyncIterable<SearchProjectionRow>;
  read(key: string): SearchProjectionRow | undefined;
}

interface RebuildInput {
  db: Database; source: SearchProjectionSource; tokenizer: SearchTokenizer;
  assertCurrent(): void;
  /** Durable policy writes only, in the index replacement transaction. */
  commitPolicy?(): void;
  publish(): void;
  signal?: AbortSignal;
}

export async function rebuildSearchProjection(input: RebuildInput): Promise<{ indexed: number }> {
  const { db, source } = input;
  const name = `taki_reindex_${randomUUID().replaceAll("-", "")}`;
  const dirty = `${name}_dirty`;
  const triggers: string[] = [];
  const assertCurrent = () => { input.signal?.throwIfAborted(); input.assertCurrent(); };
  assertCurrent();
  try {
    createCandidate(db, { source, name, dirty, triggers });
    const insert = db.prepare(`INSERT INTO ${name} (${source.columns.join(",")}) VALUES (${source.columns.map((column) => `:${column}`).join(",")})`);
    const remove = db.prepare(`DELETE FROM ${name} WHERE ${source.identities.map((column, i) => `${column}=json_extract(:key,'$[${i}]')`).join(" AND ")}`);
    let rows: SearchProjectionRow[] = [];
    const flush = () => { db.transaction(() => { for (const row of rows) appendRow(insert, row, input.tokenizer); }); rows = []; };
    for await (const row of source.scan()) {
      assertCurrent();
      rows.push(row);
      if (rows.length === 32) { flush(); await setImmediate(); }
    }
    flush();
    // Writes stay on the old tokenizer/index while preparation yields. Source-table triggers retain exact dirty keys.
    const changed = db.prepare(`SELECT key FROM ${dirty} LIMIT 32`);
    const clear = db.prepare(`DELETE FROM ${dirty} WHERE key=:key`);
    while (changed.all().length > 0) {
      assertCurrent();
      const rows = changed.all();
      db.transaction(() => {
        for (const row of rows) {
          const key = String(row.key);
          remove.run({ key });
          const current = source.read(key);
          if (current) appendRow(insert, current, input.tokenizer);
          clear.run({ key });
        }
      });
      // Final publication happens without another await once the dirty set is empty.
      if (changed.all().length === 0) break;
      await setImmediate();
    }
    assertCurrent();
    const indexed = Number(db.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n ?? 0);
    publishCandidate(input, name);
    return { indexed };
  } finally {
    for (const trigger of triggers) db.exec(`DROP TRIGGER IF EXISTS temp.${trigger}`);
    db.exec(`DROP TABLE IF EXISTS temp.${dirty}`);
    db.exec(`DROP TABLE IF EXISTS ${name}`);
  }
}

function publishCandidate(input: RebuildInput, name: string): void {
  const { db, source } = input;
  db.transaction(() => {
    input.signal?.throwIfAborted();
    input.assertCurrent();
    db.exec(`ALTER TABLE ${source.table} RENAME TO ${name}_retired`);
    db.exec(`ALTER TABLE ${name} RENAME TO ${source.table}`);
    db.exec(`DROP TABLE ${name}_retired`);
    input.commitPolicy?.();
    // First callback: synchronous observers must never see committed index rows with the old tokenizer.
    db.afterCommit(input.publish);
  });
}

function appendRow(insert: SqlStatement, row: SearchProjectionRow, tokenizer: SearchTokenizer): void {
  insert.run({ ...row.values, search_terms: row.values.search_terms ?? tokenizer.tokenize(row.text).join(" ") });
}

function createCandidate(db: Database, input: {
  source: SearchProjectionSource; name: string; dirty: string; triggers: string[];
}): void {
  const { source, name, dirty, triggers } = input;
  const columns = source.columns.map((column) => `${column}${source.identities.includes(column) ? " UNINDEXED" : ""}`).join(",");
  db.exec(`CREATE VIRTUAL TABLE ${name} USING fts5(${columns},tokenize='unicode61')`);
  db.exec(`CREATE TEMP TABLE ${dirty}(key TEXT PRIMARY KEY)`);
  for (const [index, table] of source.tracked.entries()) {
    for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
      const trigger = `${name}_${index}_${event.toLowerCase()}`;
      const sides = event === "UPDATE" ? ["OLD", "NEW"] : [event === "DELETE" ? "OLD" : "NEW"];
      const body = sides.map((side) => `INSERT OR IGNORE INTO ${dirty}(key) VALUES(json_array(${table.columns.map((column) => `${side}.${column}`).join(",")}));`).join(" ");
      db.exec(`CREATE TEMP TRIGGER ${trigger} AFTER ${event} ON main.${table.table} BEGIN ${body} END`);
      triggers.push(trigger);
    }
  }
}

/** Crash leftovers contain derived data only; the narrowly named virtual tables never become authoritative. */
export function cleanAbandonedSearchProjections(db: Database): void {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE VIRTUAL TABLE%'").all()) {
    const name = String(row.name);
    if (/^taki_reindex_[a-f0-9]{32}(?:_retired)?$/.test(name)) db.exec(`DROP TABLE ${name}`);
  }
}
