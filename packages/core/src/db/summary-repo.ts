/**
 * INPUT:  the Database wrapper + get/upsert calls (characterId-scoped rolling summary)
 * OUTPUT: createSummaryRepo(db) -> { get, upsert } over conversation_summary
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

export interface SummaryRepo {
  /** The character's rolling summary; null = never compacted. */
  get(characterId: string): ConversationSummary | null;
  /** Overwrite (or create) the character's single summary row — the compactor's success-only advance. */
  upsert(input: { characterId: string; throughSeq: number; text: string }): void;
}

const GET_SQL = "SELECT through_seq, text FROM conversation_summary WHERE character_id = :characterId";

const UPSERT_SQL =
  "INSERT INTO conversation_summary (character_id, through_seq, text, updated_at) " +
  "VALUES (:characterId, :throughSeq, :text, :updatedAt) " +
  "ON CONFLICT(character_id) DO UPDATE SET through_seq = excluded.through_seq, text = excluded.text, " +
  "updated_at = excluded.updated_at";

const RowSchema = z.object({
  through_seq: z.int().positive(),
  text: z.string(),
});

export function createSummaryRepo(db: Database): SummaryRepo {
  const getRow = db.prepare(GET_SQL);
  const upsertRow = db.prepare(UPSERT_SQL);

  return {
    get(characterId) {
      const row = getRow.get({ characterId });
      if (!row) return null;
      const parsed = RowSchema.parse(row);
      return { throughSeq: parsed.through_seq, text: parsed.text };
    },
    upsert(input) {
      upsertRow.run({
        characterId: input.characterId,
        throughSeq: input.throughSeq,
        text: input.text,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
