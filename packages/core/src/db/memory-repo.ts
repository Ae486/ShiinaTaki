/**
 * INPUT:  the Database wrapper + upsert/delete/list/search/count calls (the derived memory index) + bm25 column weights
 * OUTPUT: createMemoryRepo(db, weights?) -> { upsert, deleteByPath, listHashes, listActiveByLayers, listActiveInLayer,
 *         countActiveSince, search, resolvePath }
 * POS:    core/db — the memory aggregate's typed SQL over memory_entries + memory_fts; no node:sqlite import (uses the wrapper)
 */
import { z } from "zod";
import { DEFAULT_BM25_WEIGHTS, type Bm25Weights } from "../config/memory-config.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export interface MemoryUpsert {
  path: string;
  id: string;
  layer: string;
  characterId: string | null;
  importance: number;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  origin: string;
  expiresAt: string | null;
  contentHash: string;
  disclosure: string;
  content: string;
  /** App-segmented terms for the CJK-live FTS column; REQUIRED so no write path can silently lose 2-char recall. */
  searchTerms: string;
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
  /** Set when the entry was reinforced (R9); the age a prompt renders anchors on this, not on createdAt. */
  updatedAt: string | null;
  origin: string;
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

/** Retention's view of a row: policy metadata only, never the content (the sweeper decides, it never reads memories). */
export interface RetentionRow {
  path: string;
  layer: string;
  importance: number;
  createdAt: string;
  updatedAt: string | null;
  expiresAt: string | null;
}

export interface MemoryRepo {
  upsert(input: MemoryUpsert): void;
  deleteByPath(path: string): void;
  /** path -> content hash for every indexed row (reconciliation compares these to the files). */
  listHashes(): MemoryHashRow[];
  /** All active, unexpired, in-scope entries in the given layers (pinned/intention selection; no FTS). */
  listActiveByLayers(params: { characterId: string; layers: string[]; now: string }): MemoryEntryRow[];
  /** Every ACTIVE row of one layer store-wide, metadata only — expired rows included (retention must find them). */
  listActiveInLayer(layer: string): RetentionRow[];
  /**
   * How many in-scope entries were written or reinforced after `since` (null = never marked -> everything counts).
   * The tidy trigger reads this instead of keeping a counter column: an R9 reinforcement bumps `updated_at`, and a
   * reinforced store IS a changed store.
   */
  countActiveSince(params: { characterId: string; since: string | null; now?: string }): number;
  /** FTS candidates: MATCH (bm25 order) or LIKE fallback; filtered active/unexpired/in-scope. */
  search(params: MemorySearchParams): MemoryEntryRow[];
  /** id -> file path, scoped to the character (+ globals); deterministic pick if an id ever collides. */
  resolvePath(params: { id: string; characterId: string }): string | undefined;
}

// Column list shared by every read; disclosure/content come from the FTS side, metadata from memory_entries.
const COLS =
  "m.path, m.id, m.layer, m.character_id, m.importance, m.status, m.created_at, m.updated_at, m.origin, m.expires_at, " +
  "memory_fts.disclosure, memory_fts.content";
const JOIN = "memory_fts JOIN memory_entries m ON m.path = memory_fts.path";
// Active + unexpired + (global OR this character) — the recall scope shared by search and listActiveByLayers.
const SCOPE =
  "m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > :now) " +
  "AND (m.character_id IS NULL OR m.character_id = :characterId)";

const UPSERT_META_SQL =
  "INSERT INTO memory_entries (path, id, layer, character_id, importance, status, created_at, updated_at, origin, " +
  "expires_at, content_hash) " +
  "VALUES (:path, :id, :layer, :characterId, :importance, :status, :createdAt, :updatedAt, :origin, :expiresAt, :contentHash) " +
  "ON CONFLICT(path) DO UPDATE SET id=excluded.id, layer=excluded.layer, character_id=excluded.character_id, " +
  "importance=excluded.importance, status=excluded.status, created_at=excluded.created_at, " +
  "updated_at=excluded.updated_at, origin=excluded.origin, " +
  "expires_at=excluded.expires_at, content_hash=excluded.content_hash";

// bm25 weights are positional over ALL columns incl. the UNINDEXED path (col 0): path 0, disclosure 1, content 2,
// search_terms 3. They are boot-time config rather than caller input, so they are baked into the prepared statement
// at repo construction — search()'s parameter set stays the same for every call site.
function searchMatchSql(weights: Bm25Weights): string {
  return (
    `SELECT ${COLS} FROM ${JOIN} WHERE memory_fts MATCH :match AND ${SCOPE} ` +
    `ORDER BY bm25(memory_fts, 0.0, ${weights.disclosure}, ${weights.content}, ${weights.searchTerms}), ` +
    "m.importance DESC, m.created_at DESC LIMIT :limit"
  );
}
const SEARCH_LIKE_SQL =
  `SELECT ${COLS} FROM ${JOIN} ` +
  "WHERE (memory_fts.content LIKE :like ESCAPE '\\' OR memory_fts.disclosure LIKE :like ESCAPE '\\') " +
  `AND ${SCOPE} ORDER BY m.importance DESC, m.created_at DESC LIMIT :limit`;
const RESOLVE_SQL =
  "SELECT path FROM memory_entries WHERE id = :id AND (character_id IS NULL OR character_id = :characterId) " +
  "ORDER BY path LIMIT 1";
// Retention reads metadata only (no FTS join, no content) and deliberately does NOT filter by expiry — an expired
// intention is precisely what the `expiring` policy has to find.
const RETENTION_ROWS_SQL =
  "SELECT path, layer, importance, created_at, updated_at, expires_at FROM memory_entries " +
  "WHERE status = 'active' AND layer = :layer ORDER BY created_at";
// The age anchor is COALESCE(updated_at, created_at) so an R9 reinforcement counts as fresh activity. `since` is
// passed as '' when the character has never been tidied: ISO strings compare lexicographically, so '' is before
// every timestamp — one statement covers both cases (a NULL comparison would silently count nothing).
const COUNT_SINCE_SQL =
  `SELECT COUNT(*) AS n FROM memory_entries m WHERE ${SCOPE} AND COALESCE(m.updated_at, m.created_at) > :since`;

// Every statement this repo owns, prepared once. Separated from the method surface below so the weights (which are
// baked into the MATCH statement) have exactly one place they can enter.
function prepareStatements(db: Database, weights: Bm25Weights) {
  return {
    upsertMeta: db.prepare(UPSERT_META_SQL),
    ftsDelete: db.prepare("DELETE FROM memory_fts WHERE path = :path"),
    ftsInsert: db.prepare(
      "INSERT INTO memory_fts (path, disclosure, content, search_terms) VALUES (:path, :disclosure, :content, :searchTerms)",
    ),
    metaDelete: db.prepare("DELETE FROM memory_entries WHERE path = :path"),
    hashes: db.prepare("SELECT path, content_hash FROM memory_entries"),
    searchMatch: db.prepare(searchMatchSql(weights)),
    searchLike: db.prepare(SEARCH_LIKE_SQL),
    resolve: db.prepare(RESOLVE_SQL),
    retentionRows: db.prepare(RETENTION_ROWS_SQL),
    countSince: db.prepare(COUNT_SINCE_SQL),
  };
}

export function createMemoryRepo(db: Database, weights: Bm25Weights = DEFAULT_BM25_WEIGHTS): MemoryRepo {
  const { upsertMeta, ftsDelete, ftsInsert, metaDelete, hashes, searchMatch, searchLike, resolve, retentionRows, countSince } =
    prepareStatements(db, weights);

  return {
    upsert(input) {
      db.transaction(() => {
        upsertMeta.run(toMetaParams(input));
        ftsDelete.run({ path: input.path });
        const { path, disclosure, content, searchTerms } = input;
        ftsInsert.run({ path, disclosure, content, searchTerms });
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
    listActiveInLayer(layer) {
      return retentionRows.all({ layer }).map(toRetentionRow);
    },
    countActiveSince({ characterId, since, now = new Date().toISOString() }) {
      const row = countSince.get({ characterId, now, since: since ?? "" });
      return row ? Number(row.n) : 0;
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
    updatedAt: input.updatedAt,
    origin: input.origin,
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
  updatedAt: z.string().nullable(),
  origin: z.string(),
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
    updatedAt: row.updated_at,
    origin: row.origin,
    expiresAt: row.expires_at,
    disclosure: row.disclosure,
    content: row.content,
  });
}

const RetentionRowSchema = z.object({
  path: z.string(),
  layer: z.string(),
  importance: z.int(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

function toRetentionRow(row: SqlRow): RetentionRow {
  return RetentionRowSchema.parse({
    path: row.path,
    layer: row.layer,
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  });
}
