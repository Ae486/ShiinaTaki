/**
 * INPUT:  the Database wrapper + append/paging calls (characterId-scoped)
 * OUTPUT: atomic Timeline batches, immutable source context, names-only calls, compatible legacy reads and bounded Character ids
 * POS:    core/db — timeline SQL and defense-in-depth privacy boundary; raw tool-call input never crosses the repo
 */
import { randomUUID } from "node:crypto";
import {
  getValidToolDisplayName,
  TimelineEntrySchema,
  TimelinePartSchema,
  SourceContextSchema,
  type TimelineEntry,
  type TimelineHistoryParams,
  type TimelineHistoryResult,
  type TimelinePart,
  type TimelineRole,
  type TimelinePresentation,
  type SourceContext,
} from "@taki/shared";
import type { Database, SqlRow, SqlStatement } from "./sqlite.ts";

export interface AppendInput {
  characterId: string;
  role: TimelineRole;
  content: string;
  /** Structured model-replay fidelity (tool calls/results); omitted = plain text row (stored as NULL). */
  parts?: TimelinePart[];
  presentation?: TimelinePresentation;
  sourceContext?: SourceContext;
}

export interface TimelineRepo {
  /** Appends one entry, returning it with its assigned seq + createdAt. */
  append(input: AppendInput): TimelineEntry;
  /** Validates every row before one synchronous transaction; an invalid/failed insert publishes no partial turn. */
  appendBatch(inputs: AppendInput[]): TimelineEntry[];
  /** Deletes one entry by (characterId, seq); a no-op when it does not exist (cancel-retract, single-writer). */
  deleteEntry(characterId: string, seq: number): void;
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
  "INSERT INTO timeline_messages (id, character_id, role, content, parts, presentation, source_context_json, created_at) " +
  "VALUES (:id, :characterId, :role, :content, :parts, :presentation, :sourceContext, :createdAt)";

const DELETE_SQL = "DELETE FROM timeline_messages WHERE character_id = :characterId AND seq = :seq";

// (:before IS NULL OR seq < :before): one prepared statement serves both the newest and cursor pages.
const PAGE_SQL =
  "SELECT seq, id, character_id, role, content, parts, presentation, source_context_json, created_at FROM timeline_messages " +
  "WHERE character_id = :characterId AND (:before IS NULL OR seq < :before) ORDER BY seq DESC LIMIT :limit";

const LATEST_SQL =
  "SELECT seq, id, character_id, role, content, parts, presentation, source_context_json, created_at FROM timeline_messages " +
  "WHERE character_id = :characterId ORDER BY seq DESC LIMIT :limit";

const MAX_SEQ_SQL =
  "SELECT COALESCE(MAX(seq), 0) AS seq FROM timeline_messages WHERE character_id = :characterId";

// (after, through]: the segment about to leave the window (flush) or since the last summary (episodic).
const RANGE_SQL =
  "SELECT seq, id, character_id, role, content, parts, presentation, source_context_json, created_at FROM timeline_messages " +
  "WHERE character_id = :characterId AND seq > :after AND seq <= :through ORDER BY seq ASC";

export function createTimelineRepo(db: Database): TimelineRepo {
  const insert = db.prepare(INSERT_SQL);
  const del = db.prepare(DELETE_SQL);
  const page = db.prepare(PAGE_SQL);
  const latest = db.prepare(LATEST_SQL);
  const maxSeq = db.prepare(MAX_SEQ_SQL);
  const range = db.prepare(RANGE_SQL);
  const appendBatch = batchAppender(db, insert);

  return {
    append(input) {
      const entry = appendBatch([input])[0];
      if (!entry) throw new Error("timeline append produced no row");
      return entry;
    },
    appendBatch,

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
}

function batchAppender(db: Database, insert: SqlStatement): TimelineRepo["appendBatch"] {
  return (inputs) => {
    const prepared = inputs.map(prepareTimelineEntry);
    const entries: TimelineEntry[] = [];
    db.transaction(() => {
      for (const row of prepared) {
        const { lastInsertRowid } = insert.run({
          id: row.id, characterId: row.characterId, role: row.role, content: row.content, createdAt: row.createdAt,
          parts: row.parts === undefined ? null : JSON.stringify(row.parts),
          presentation: row.presentation === undefined ? null : JSON.stringify(row.presentation),
          sourceContext: row.sourceContext === undefined ? null : JSON.stringify(row.sourceContext),
        });
        entries.push({ ...row, seq: lastInsertRowid });
      }
    });
    return entries;
  };
}

export function prepareTimelineEntry(input: AppendInput): TimelineEntry {
  return TimelineEntrySchema.parse({
    ...input, parts: sanitizeParts(input.parts), seq: 1, id: randomUUID(), createdAt: new Date().toISOString(),
  });
}

export function toEntry(row: SqlRow): TimelineEntry {
  return TimelineEntrySchema.parse({
    seq: row.seq,
    id: row.id,
    characterId: row.character_id,
    role: row.role,
    content: row.content,
    parts: sanitizeParts(parseParts(row)),
    presentation: parsePresentation(row.presentation),
    ...(row.source_context_json == null ? {} : { sourceContext: parseSourceContext(row) }),
    createdAt: row.created_at,
  });
}

function parseSourceContext(row: SqlRow): SourceContext {
  try {
    return SourceContextSchema.parse(JSON.parse(String(row.source_context_json)));
  } catch (error) {
    // Attribution affects interpretation; corrupt evidence cannot silently become an unknown legacy source.
    throw new Error(`timeline row seq=${String(row.seq)} has corrupt source context JSON`, { cause: error });
  }
}

// NULL = legacy text-only row. A corrupt JSON cell must fail loudly with the row's seq, not as a bare SyntaxError.
function parseParts(row: SqlRow): TimelinePart[] | undefined {
  if (row.parts === null || row.parts === undefined) return undefined;
  try {
    return TimelinePartSchema.array().parse(JSON.parse(String(row.parts)));
  } catch (error) {
    throw new Error(`timeline row seq=${String(row.seq)} has corrupt parts JSON`, { cause: error });
  }
}

function parsePresentation(value: SqlRow[string] | undefined): unknown {
  if (typeof value !== "string") return undefined;
  try { return JSON.parse(value) as unknown; }
  catch { return undefined; } // Optional display corruption must not hide otherwise valid canonical history.
}

function sanitizeParts(parts: TimelinePart[] | undefined): TimelinePart[] | undefined {
  return parts?.map((part) => {
    if (part.type !== "tool-call" && part.type !== "tool-result") return part;
    const displayName = getValidToolDisplayName(part.displayName);
    const identity = {
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      ...(displayName === undefined ? {} : { displayName }),
      ...(part.contextOrigin === undefined ? {} : { contextOrigin: part.contextOrigin }),
    };
    // Do not recurse into output: its business data must survive even when it has a displayName or input field.
    return part.type === "tool-call"
      ? { type: part.type, ...identity }
      : { type: part.type, ...identity, output: part.output,
        ...(part.imageRefs === undefined ? {} : { imageRefs: part.imageRefs }),
        ...(part.sourceMaterials === undefined ? {} : { sourceMaterials: part.sourceMaterials }) };
  });
}

/** Distinct Characters with Timeline history, bounded; ids longer than the protocol id limit are never projected. */
export function listTimelineCharacterIds(db: Database, limit: number): string[] {
  return db.prepare(`SELECT DISTINCT character_id FROM timeline_messages WHERE length(character_id) <= 256
    ORDER BY character_id LIMIT :limit`).all({ limit }).map((row) => String(row.character_id));
}
