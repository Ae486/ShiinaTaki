/**
 * INPUT: isolated historical main database and plain Timeline append/paging calls
 * OUTPUT: frozen-main Timeline semantics plus an atomic batch test adapter
 * POS: core/testing — preserves capped main schema; never upgrades archived evidence or accepts newer source fields
 */
import { randomUUID } from "node:crypto";
import {
  TimelineEntrySchema,
  TimelinePartSchema,
  type TimelineEntry,
  type TimelinePart,
} from "@taki/shared";
import { z } from "zod";
import type { Database, SqlRow } from "../db/sqlite.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";

const INSERT_SQL =
  "INSERT INTO timeline_messages (id, character_id, role, content, parts, created_at) " +
  "VALUES (:id, :characterId, :role, :content, :parts, :createdAt)";

const DELETE_SQL = "DELETE FROM timeline_messages WHERE character_id = :characterId AND seq = :seq";

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

export function createHistoricalMainTimelineRepo(db: Database): TimelineRepo {
  const insert = db.prepare(INSERT_SQL);
  const del = db.prepare(DELETE_SQL);
  const page = db.prepare(PAGE_SQL);
  const latest = db.prepare(LATEST_SQL);
  const maxSeq = db.prepare(MAX_SEQ_SQL);
  const range = db.prepare(RANGE_SQL);

  const historical: Omit<TimelineRepo, "appendBatch"> = {
    append(input) {
      if (input.sourceContext || input.presentation) throw new Error("Historical main Timeline cannot store newer source fields");
      const parts = sanitizeParts(input.parts);
      const row = {
        id: randomUUID(),
        characterId: input.characterId,
        role: input.role,
        content: input.content,
        createdAt: new Date().toISOString(),
      };
      const { lastInsertRowid } = insert.run({
        ...row,
        parts: parts === undefined ? null : JSON.stringify(parts),
      });
      return TimelineEntrySchema.parse({ seq: lastInsertRowid, ...row, parts });
    },

    deleteEntry(characterId, seq) {
      del.run({ characterId, seq });
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
  return { ...historical, appendBatch: (inputs) => {
    const entries: TimelineEntry[] = [];
    db.transaction(() => { for (const input of inputs) entries.push(historical.append(input)); });
    return entries;
  } };
}

function toEntry(row: SqlRow): TimelineEntry {
  return TimelineEntrySchema.parse({
    seq: row.seq,
    id: row.id,
    characterId: row.character_id,
    role: row.role,
    content: row.content,
    parts: sanitizeParts(parseParts(row)),
    createdAt: row.created_at,
  });
}

// NULL = legacy text-only row. A corrupt JSON cell must fail loudly with the row's seq, not as a bare SyntaxError.
function parseParts(row: SqlRow): TimelinePart[] | undefined {
  if (row.parts === null || row.parts === undefined) return undefined;
  try {
    return z.array(TimelinePartSchema).parse(JSON.parse(String(row.parts)));
  } catch (error) {
    throw new Error(`timeline row seq=${String(row.seq)} has corrupt parts JSON`, { cause: error });
  }
}

function sanitizeParts(parts: TimelinePart[] | undefined): TimelinePart[] | undefined {
  return parts?.map((part) => part.type === "tool-call"
    ? { type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName }
    : part);
}
