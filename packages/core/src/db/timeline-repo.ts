/**
 * INPUT:  the Database wrapper + append/paging calls (characterId-scoped)
 * OUTPUT: createTimelineRepo(db) -> { append, pageBefore, latestAscending, latestSeq, rangeAscending } over timeline_messages
 * POS:    core/db — the timeline aggregate's typed SQL; zod-parses rows at the boundary; no node:sqlite import
 */
import { randomUUID } from "node:crypto";
import {
  TimelineEntrySchema,
  type TimelineEntry,
  type TimelineHistoryParams,
  type TimelineHistoryResult,
  type TimelinePart,
  type TimelineRole,
} from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";

export interface AppendInput {
  characterId: string;
  role: TimelineRole;
  content: string;
  /** Structured model-replay fidelity (tool calls/results); omitted = plain text row (stored as NULL). */
  parts?: TimelinePart[];
}

export interface TimelineRepo {
  /** Appends one entry, returning it with its assigned seq + createdAt. */
  append(input: AppendInput): TimelineEntry;
  /** One newest-first page with an exclusive `before` seq cursor; nextBefore=null at the end. */
  pageBefore(query: TimelineHistoryParams): TimelineHistoryResult;
  /** The latest `limit` entries in ascending order (the model replay window). */
  latestAscending(characterId: string, limit: number): TimelineEntry[];
  /** The highest seq for the character, or 0 when it has no messages (auto-memory watermark math). */
  latestSeq(characterId: string): number;
  /** Entries in the half-open seq range (after, through], ascending (auto-memory segment fetch). */
  rangeAscending(characterId: string, after: number, through: number): TimelineEntry[];
}

const INSERT_SQL =
  "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) " +
  "VALUES (:id, :characterId, :role, :content, :parts, :createdAt)";

// (:before IS NULL OR seq < :before): one prepared statement serves both the newest and cursor pages.
const PAGE_SQL =
  "SELECT seq, id, character_id, role, content, parts, created_at FROM timeline_messages " +
  "WHERE character_id = :characterId AND (:before IS NULL OR seq < :before) ORDER BY seq DESC LIMIT :limit";

const LATEST_SQL =
  "SELECT seq, id, character_id, role, content, parts, created_at FROM timeline_messages " +
  "WHERE character_id = :characterId ORDER BY seq DESC LIMIT :limit";

const MAX_SEQ_SQL =
  "SELECT COALESCE(MAX(seq), 0) AS seq FROM timeline_messages WHERE character_id = :characterId";

// (after, through]: the segment about to leave the window (flush) or since the last summary (episodic).
const RANGE_SQL =
  "SELECT seq, id, character_id, role, content, parts, created_at FROM timeline_messages " +
  "WHERE character_id = :characterId AND seq > :after AND seq <= :through ORDER BY seq ASC";

export function createTimelineRepo(db: Database): TimelineRepo {
  const insert = db.prepare(INSERT_SQL);
  const page = db.prepare(PAGE_SQL);
  const latest = db.prepare(LATEST_SQL);
  const maxSeq = db.prepare(MAX_SEQ_SQL);
  const range = db.prepare(RANGE_SQL);

  return {
    append(input) {
      const row = {
        id: randomUUID(),
        characterId: input.characterId,
        role: input.role,
        content: input.content,
        createdAt: new Date().toISOString(),
      };
      const { lastInsertRowid } = insert.run({
        ...row,
        parts: input.parts === undefined ? null : JSON.stringify(input.parts),
      });
      return TimelineEntrySchema.parse({ seq: lastInsertRowid, ...row, parts: input.parts });
    },

    pageBefore(query) {
      // Over-fetch by one to learn whether an older page exists without a second query.
      const rows = page.all({
        characterId: query.characterId,
        before: query.before ?? null,
        limit: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const entries = (hasMore ? rows.slice(0, query.limit) : rows).map(toEntry);
      const nextBefore = hasMore ? (entries.at(-1)?.seq ?? null) : null;
      return { entries, nextBefore };
    },

    latestAscending(characterId, limit) {
      return latest.all({ characterId, limit }).map(toEntry).reverse();
    },

    latestSeq(characterId) {
      return Number(maxSeq.get({ characterId })?.seq ?? 0);
    },

    rangeAscending(characterId, after, through) {
      return range.all({ characterId, after, through }).map(toEntry);
    },
  };
}

function toEntry(row: SqlRow): TimelineEntry {
  return TimelineEntrySchema.parse({
    seq: row.seq,
    id: row.id,
    characterId: row.character_id,
    role: row.role,
    content: row.content,
    parts: parseParts(row),
    createdAt: row.created_at,
  });
}

// NULL = legacy text-only row. A corrupt JSON cell must fail loudly with the row's seq, not as a bare SyntaxError.
function parseParts(row: SqlRow): unknown {
  if (row.parts === null || row.parts === undefined) return undefined;
  try {
    return JSON.parse(String(row.parts));
  } catch (error) {
    throw new Error(`timeline row seq=${String(row.seq)} has corrupt parts JSON`, { cause: error });
  }
}
