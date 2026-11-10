/**
 * INPUT: canonical Local authority epoch and authoritative units/policy rows
 * OUTPUT: bounded source pages and concurrent-delta reads for derived sparse-index replacement
 * POS: core/memory — Local search maintenance adapter; excludes hidden/invalidated records at the source
 */
import type { Database, SqlRow } from "../db/sqlite.ts";
import { CANONICAL_MEMORY_FTS_ELIGIBLE } from "../db/canonical-memory-maintenance-records.ts";
import type { SearchProjectionRow, SearchProjectionSource } from "./search-projection-rebuild.ts";

export function canonicalSearchProjection(db: Database, epochId: string): SearchProjectionSource {
  const columns = ["authority_epoch_id", "bank_id", "memory_id", "text", "context", "search_terms"];
  const identities = columns.slice(0, 3);
  const select = `SELECT u.rowid AS cursor,u.authority_epoch_id,u.bank_id,u.memory_id,u.text,u.context,p.disclosure
    FROM canonical_memory_units u JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id
      AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id
    WHERE u.authority_epoch_id=:epoch AND ${CANONICAL_MEMORY_FTS_ELIGIBLE}`;
  const page = db.prepare(`${select} AND u.rowid>:cursor ORDER BY u.rowid LIMIT 64`);
  const read = db.prepare(`${select} AND u.bank_id=:bank AND u.memory_id=:memory`);
  const preserved = db.prepare("SELECT rowid AS cursor,* FROM canonical_memory_fts WHERE authority_epoch_id<>:epoch AND rowid>:cursor ORDER BY rowid LIMIT 64");
  return { table: "canonical_memory_fts", columns, identities,
    tracked: ["canonical_memory_units", "canonical_memory_policy"].map((table) => ({ table, columns: identities })),
    async *scan() {
      let cursor = 0;
      while (true) {
        const rows = page.all({ epoch: epochId, cursor });
        if (rows.length === 0) break;
        for (const row of rows) { cursor = Number(row.cursor); yield project(row); }
      }
      cursor = 0;
      while (true) {
        const rows = preserved.all({ epoch: epochId, cursor });
        if (rows.length === 0) return;
        for (const row of rows) { cursor = Number(row.cursor); yield preserve(row); }
      }
    },
    read(key) {
      const [epoch, bank, memory] = JSON.parse(key) as string[];
      if (epoch !== epochId) {
        const row = db.prepare("SELECT * FROM canonical_memory_fts WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory")
          .get({ epoch: epoch!, bank: bank!, memory: memory! });
        return row ? preserve(row) : undefined;
      }
      const row = read.get({ epoch: epochId, bank: bank!, memory: memory! });
      return row ? project(row) : undefined;
    },
  };
}

function preserve(row: SqlRow): SearchProjectionRow {
  const projected = project(row);
  return { ...projected, values: { ...projected.values, search_terms: row.search_terms! } };
}

function project(row: SqlRow): SearchProjectionRow {
  const { authority_epoch_id: epoch, bank_id: bank, memory_id: memory, text, context } = row;
  return { key: JSON.stringify([epoch, bank, memory]), values: { authority_epoch_id: epoch!, bank_id: bank!, memory_id: memory!,
    text: text!, context: context ?? null }, text: [text, context, row.disclosure].filter((value) => typeof value === "string").join(" ") };
}
