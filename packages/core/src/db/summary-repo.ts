/**
 * INPUT:  the Database wrapper + get/upsert calls (characterId-scoped rolling summary)
 * OUTPUT: createSummaryRepo(db) -> projection reads, revisioned checkpoint reads, compatibility upsert, and metadata
 * POS:    core/db — the compaction summary's typed SQL (T5-R3: one overwritable row per character, never a
 *         timeline row); upsert semantics; no node:sqlite import (uses the wrapper)
 */
import { z } from "zod";
import type { Database } from "./sqlite.ts";

export interface ConversationSummary {
  /** Highest timeline seq the summary covers ([beginning .. throughSeq] has been retired into it). */
  throughSeq: number;
  text: string;
}

/** Durable checkpoint metadata used only by the compaction CAS path; the text remains projection-only. */
export interface ConversationSummaryCheckpoint extends ConversationSummary {
  revision: number;
  lastOperationId: string | null;
  sourceFromSeq: number | null;
  sourceThroughSeq: number | null;
  sourceDigest: string | null;
  capturedTailSeq: number | null;
}

/** The summary WITHOUT its text: the operator status read never loads conversation content into an operator surface. */
export interface ConversationSummaryMeta {
  throughSeq: number;
  textChars: number;
  updatedAt: string;
}

export interface SummaryRepo {
  /** The character's rolling summary; null = never compacted. */
  get(characterId: string): ConversationSummary | null;
  /** Full revision/source checkpoint for the durable compaction CAS path. */
  getCheckpoint(characterId: string): ConversationSummaryCheckpoint | null;
  /** Compatibility/setup overwrite; production compaction commits through CompactionOperationRepo instead. */
  upsert(input: { characterId: string; throughSeq: number; text: string }): void;
  /** Counts only (length, not text) — the memory.status card's source. */
  getMeta(characterId: string): ConversationSummaryMeta | null;
}

const GET_SQL = "SELECT through_seq, text FROM conversation_summary WHERE character_id = :characterId";

const CHECKPOINT_SQL = `SELECT through_seq,text,revision,last_operation_id,source_from_seq,source_through_seq,
  source_digest,captured_tail_seq FROM conversation_summary WHERE character_id=:characterId`;

// LENGTH() in SQL, so the text itself never leaves the database for this read path.
const META_SQL =
  "SELECT through_seq, LENGTH(text) AS text_chars, updated_at FROM conversation_summary WHERE character_id = :characterId";

const UPSERT_SQL =
  "INSERT INTO conversation_summary (character_id, through_seq, text, updated_at, revision) " +
  "VALUES (:characterId, :throughSeq, :text, :updatedAt, 1) " +
  "ON CONFLICT(character_id) DO UPDATE SET through_seq=excluded.through_seq,text=excluded.text, " +
  "updated_at=excluded.updated_at,revision=conversation_summary.revision+1,last_operation_id=NULL, " +
  "source_from_seq=NULL,source_through_seq=NULL,source_digest=NULL,captured_tail_seq=NULL";

const RowSchema = z.object({
  through_seq: z.int().positive(),
  text: z.string(),
});

const MetaSchema = z.object({
  through_seq: z.int().positive(),
  text_chars: z.int().min(0),
  updated_at: z.string().min(1),
});

const CheckpointSchema = z.object({
  through_seq: z.int().positive(),
  text: z.string(),
  revision: z.int().positive(),
  last_operation_id: z.string().min(1).max(100).nullable(),
  source_from_seq: z.int().positive().nullable(),
  source_through_seq: z.int().positive().nullable(),
  source_digest: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  captured_tail_seq: z.int().positive().nullable(),
});

export function createSummaryRepo(db: Database): SummaryRepo {
  const getRow = db.prepare(GET_SQL);
  const upsertRow = db.prepare(UPSERT_SQL);
  const getMetaRow = db.prepare(META_SQL);
  const getCheckpointRow = db.prepare(CHECKPOINT_SQL);

  return {
    get(characterId) {
      const row = getRow.get({ characterId });
      if (!row) return null;
      const parsed = RowSchema.parse(row);
      return { throughSeq: parsed.through_seq, text: parsed.text };
    },
    getCheckpoint(characterId) {
      const row = getCheckpointRow.get({ characterId });
      if (!row) return null;
      const parsed = CheckpointSchema.parse(row);
      return {
        throughSeq: parsed.through_seq,
        text: parsed.text,
        revision: parsed.revision,
        lastOperationId: parsed.last_operation_id,
        sourceFromSeq: parsed.source_from_seq,
        sourceThroughSeq: parsed.source_through_seq,
        sourceDigest: parsed.source_digest,
        capturedTailSeq: parsed.captured_tail_seq,
      };
    },
    upsert(input) {
      upsertRow.run({
        characterId: input.characterId,
        throughSeq: input.throughSeq,
        text: input.text,
        updatedAt: new Date().toISOString(),
      });
    },
    getMeta(characterId) {
      const row = getMetaRow.get({ characterId });
      if (!row) return null;
      const parsed = MetaSchema.parse(row);
      return { throughSeq: parsed.through_seq, textChars: parsed.text_chars, updatedAt: parsed.updated_at };
    },
  };
}
