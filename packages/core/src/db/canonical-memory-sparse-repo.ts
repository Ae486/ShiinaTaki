/**
 * INPUT:  canonical FTS5 projection rows, shared tokenizer, and bounded sparse recall parameters
 * OUTPUT: BM25 search, transactional projection maintenance, and complete rebuild from canonical units
 * POS:    core/db — rebuildable sparse projection; never authoritative and never indexes structured Blocks
 */
import type { RecallRequest } from "@taki/shared";
import { buildFtsQuery } from "../memory/fts5-query.ts";
import type { SearchTokenizer } from "../memory/search-tokenizer.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export interface SparseRow { epochId: string; bankId: string; memoryId: string; text: string; context: string | null; rank: number; layerId: string; factType: "world" | "experience" | "observation"; }
export interface CanonicalMemorySparseRepo {
  upsert(input: { epochId: string; bankId: string; memoryId: string; text: string; context: string | null; searchTerms: string }): void;
  remove(input: { epochId: string; bankId: string; memoryId: string }): void;
  search(request: RecallRequest, tokenizer: SearchTokenizer, epochId: string): SparseRow[];
  rebuild(epochId: string, tokenizer: SearchTokenizer): void;
}

export function createCanonicalMemorySparseRepo(db: Database): CanonicalMemorySparseRepo {
  return {
    upsert: (input) => upsert(db, input),
    remove: (input) => db.prepare("DELETE FROM canonical_memory_fts WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory").run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId }),
    search: (request, tokenizer, epochId) => search(db, { request, tokenizer, epochId }),
    rebuild: (epochId, tokenizer) => rebuild(db, epochId, tokenizer),
  };
}
function search(db: Database, input: { request: RecallRequest; tokenizer: SearchTokenizer; epochId: string }): SparseRow[] {
  const { request, tokenizer, epochId } = input;
  const query = buildFtsQuery(tokenizer, request.query);
  if (query.kind === "empty") return [];
  const select = "SELECT f.authority_epoch_id,f.bank_id,f.memory_id,u.text,u.context,u.fact_type,p.layer_id";
  const joins = "FROM canonical_memory_fts f JOIN canonical_memory_units u ON u.authority_epoch_id=f.authority_epoch_id AND u.bank_id=f.bank_id AND u.memory_id=f.memory_id JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id";
  const filters = "WHERE f.authority_epoch_id=:epoch AND f.bank_id=:bank AND u.state='valid' AND u.fact_type IN (SELECT value FROM json_each(:facts)) AND (:all_layers=1 OR p.layer_id IN (SELECT value FROM json_each(:layers)))";
  const matchSql = `${select},bm25(canonical_memory_fts) AS rank ${joins} ${filters} AND canonical_memory_fts MATCH :query ORDER BY rank ASC,p.importance DESC,u.updated_at DESC,u.memory_id ASC LIMIT :limit`;
  const likeSql = `${select},0 AS rank ${joins} ${filters} AND (f.text LIKE :query ESCAPE '\\' OR ifnull(f.context,'') LIKE :query ESCAPE '\\' OR f.search_terms LIKE :query ESCAPE '\\') ORDER BY p.importance DESC,u.updated_at DESC,u.memory_id ASC LIMIT :limit`;
  const rows = db.prepare(query.kind === "match" ? matchSql : likeSql).all({ epoch: epochId, bank: request.bankId, query: query.kind === "match" ? query.match : query.like, facts: JSON.stringify(request.factTypes), layers: JSON.stringify(request.layerIds), all_layers: request.layerIds.length === 0 ? 1 : 0, limit: request.limit });
  return rows.map(parseRow);
}
function parseRow(row: SqlRow): SparseRow { return { epochId: String(row.authority_epoch_id), bankId: String(row.bank_id), memoryId: String(row.memory_id), text: String(row.text), context: row.context === null ? null : String(row.context), rank: Number(row.rank), layerId: String(row.layer_id), factType: row.fact_type as SparseRow["factType"] }; }
function upsert(db: Database, input: { epochId: string; bankId: string; memoryId: string; text: string; context: string | null; searchTerms: string }): void {
  db.transaction(() => {
    db.prepare("DELETE FROM canonical_memory_fts WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory").run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId });
    db.prepare("INSERT INTO canonical_memory_fts (authority_epoch_id,bank_id,memory_id,text,context,search_terms) VALUES (:epoch,:bank,:memory,:text,:context,:terms)").run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId, text: input.text, context: input.context, terms: input.searchTerms });
  });
}
function rebuild(db: Database, epochId: string, tokenizer: SearchTokenizer): void {
  db.transaction(() => {
    db.prepare("DELETE FROM canonical_memory_fts WHERE authority_epoch_id=:epoch").run({ epoch: epochId });
    const rows = db.prepare("SELECT u.authority_epoch_id,u.bank_id,u.memory_id,u.text,u.context,p.disclosure FROM canonical_memory_units u JOIN canonical_memory_policy p ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id WHERE u.authority_epoch_id=:epoch AND u.state='valid'").all({ epoch: epochId });
    const insert = db.prepare("INSERT INTO canonical_memory_fts (authority_epoch_id,bank_id,memory_id,text,context,search_terms) VALUES (:authority_epoch_id,:bank_id,:memory_id,:text,:context,:search_terms)");
    for (const row of rows) insert.run({ authority_epoch_id: String(row.authority_epoch_id), bank_id: String(row.bank_id), memory_id: String(row.memory_id), text: String(row.text), context: row.context === null ? null : String(row.context), search_terms: tokenizeProjection(tokenizer, row) });
  });
}
function tokenizeProjection(tokenizer: SearchTokenizer, row: SqlRow): string {
  return tokenizer.tokenize([row.text, row.context, row.disclosure].filter((value): value is string => typeof value === "string").join(" ")).join(" ");
}
