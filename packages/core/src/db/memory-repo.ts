/**
 * INPUT:  the Database wrapper + upsert/delete/list/search calls (the derived memory index)
 * OUTPUT: createMemoryRepo(db) -> { upsert, deleteByPath, listHashes, listActiveByLayers, search, resolvePath }
 * POS:    core/db — the memory aggregate's typed SQL over memory_entries + memory_fts; no node:sqlite import (uses the wrapper)
 */
import { z } from "zod";
import type { Database, SqlRow } from "./sqlite.ts";

export interface MemoryUpsert {
  path: string;
  id: string;
  layer: string;
  characterId: string | null;
  importance: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  contentHash: string;
  disclosure: string;
  content: string;
}

export interface MemoryHashRow {
  path: string;
  contentHash: string;
}

export interface MemoryEntryRow {
  path: string;
  id: string;
  layer: string;
  characterId: string | null;
  importance: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  disclosure: string;
  content: string;
}

export interface MemorySearchParams {
  match?: string;
  like?: string;
  characterId: string;
  now: string;
  limit: number;
}

export interface MemoryRepo {
  upsert(input: MemoryUpsert): void;
  deleteByPath(path: string): void;
  /** path -> content hash for every indexed row (reconciliation compares these to the files). */
  listHashes(): MemoryHashRow[];
  /** All active, unexpired, in-scope entries in the given layers (pinned/intention selection; no FTS). */
  listActiveByLayers(params: { characterId: string; layers: string[]; now: string }): MemoryEntryRow[];
  /** FTS candidates: MATCH (bm25 order) or LIKE fallback; filtered active/unexpired/in-scope. */
  search(params: MemorySearchParams): MemoryEntryRow[];
  /** id -> file path, scoped to the character (+ globals); deterministic pick if an id ever collides. */
  resolvePath(params: { id: string; characterId: string }): string | undefined;
}

// Column list shared by every read; disclosure/content come from the FTS side, metadata from memory_entries.
const COLS =
  "m.path, m.id, m.layer, m.character_id, m.importance, m.status, m.created_at, m.expires_at, " +
  "memory_fts.disclosure, memory_fts.content";
const JOIN = "memory_fts JOIN memory_entries m ON m.path = memory_fts.path";
// Active + unexpired + (global OR this character) — the recall scope shared by search and listActiveByLayers.
const SCOPE =
  "m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > :now) " +
  "AND (m.character_id IS NULL OR m.character_id = :characterId)";

const UPSERT_META_SQL =
  "INSERT INTO memory_entries (path, id, layer, character_id, importance, status, created_at, expires_at, content_hash) " +
  "VALUES (:path, :id, :layer, :characterId, :importance, :status, :createdAt, :expiresAt, :contentHash) " +
  "ON CONFLICT(path) DO UPDATE SET id=excluded.id, layer=excluded.layer, character_id=excluded.character_id, " +
  "importance=excluded.importance, status=excluded.status, created_at=excluded.created_at, " +
  "expires_at=excluded.expires_at, content_hash=excluded.content_hash";

// bm25 weights are positional over ALL columns incl. the UNINDEXED path (col 0): path 0, disclosure 1, content 2.
const SEARCH_MATCH_SQL =
  `SELECT ${COLS} FROM ${JOIN} WHERE memory_fts MATCH :match AND ${SCOPE} ` +
  "ORDER BY bm25(memory_fts, 0.0, 1.0, 2.0), m.importance DESC, m.created_at DESC LIMIT :limit";
const SEARCH_LIKE_SQL =
  `SELECT ${COLS} FROM ${JOIN} ` +
  "WHERE (memory_fts.content LIKE :like ESCAPE '\\' OR memory_fts.disclosure LIKE :like ESCAPE '\\') " +
  `AND ${SCOPE} ORDER BY m.importance DESC, m.created_at DESC LIMIT :limit`;

export function createMemoryRepo(db: Database): MemoryRepo {
  const upsertMeta = db.prepare(UPSERT_META_SQL);
  const ftsDelete = db.prepare("DELETE FROM memory_fts WHERE path = :path");
  const ftsInsert = db.prepare("INSERT INTO memory_fts (path, disclosure, content) VALUES (:path, :disclosure, :content)");
  const metaDelete = db.prepare("DELETE FROM memory_entries WHERE path = :path");
  const hashes = db.prepare("SELECT path, content_hash FROM memory_entries");
  const searchMatch = db.prepare(SEARCH_MATCH_SQL);
  const searchLike = db.prepare(SEARCH_LIKE_SQL);
  const resolve = db.prepare(
    "SELECT path FROM memory_entries WHERE id = :id AND (character_id IS NULL OR character_id = :characterId) " +
      "ORDER BY path LIMIT 1",
  );

  return {
    upsert(input) {
      db.transaction(() => {
        upsertMeta.run(toMetaParams(input));
        ftsDelete.run({ path: input.path });
        ftsInsert.run({ path: input.path, disclosure: input.disclosure, content: input.content });
      });
    },
    deleteByPath(path) {
      db.transaction(() => {
        metaDelete.run({ path });
        ftsDelete.run({ path });
      });
    },
    listHashes() {
      return hashes.all().map((row) => ({ path: String(row.path), contentHash: String(row.content_hash) }));
    },
    listActiveByLayers({ characterId, layers, now }) {
      if (layers.length === 0) return [];
      const keys = layers.map((_, i) => `l${i}`);
      const inList = keys.map((key) => `:${key}`).join(", ");
      const sql = `SELECT ${COLS} FROM ${JOIN} WHERE ${SCOPE} AND m.layer IN (${inList}) ORDER BY m.importance DESC, m.created_at DESC`;
      const params = { now, characterId, ...Object.fromEntries(keys.map((key, i) => [key, layers[i]])) };
      return db.prepare(sql).all(params).map(toRow);
    },
    search({ match, like, characterId, now, limit }) {
      if (match !== undefined) return searchMatch.all({ match, characterId, now, limit }).map(toRow);
      if (like !== undefined) return searchLike.all({ like, characterId, now, limit }).map(toRow);
      return [];
    },
    resolvePath({ id, characterId }) {
      const row = resolve.get({ id, characterId });
      return row ? String(row.path) : undefined;
    },
  };
}

function toMetaParams(input: MemoryUpsert): SqlRow {
  return {
    path: input.path,
    id: input.id,
    layer: input.layer,
    characterId: input.characterId,
    importance: input.importance,
    status: input.status,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    contentHash: input.contentHash,
  };
}

const RowSchema = z.object({
  path: z.string(),
  id: z.string(),
  layer: z.string(),
  characterId: z.string().nullable(),
  importance: z.int(),
  status: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  disclosure: z.string(),
  content: z.string(),
});

function toRow(row: SqlRow): MemoryEntryRow {
  return RowSchema.parse({
    path: row.path,
    id: row.id,
    layer: row.layer,
    characterId: row.character_id,
    importance: row.importance,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    disclosure: row.disclosure,
    content: row.content,
  });
}
