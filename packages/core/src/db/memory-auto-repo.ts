/**
 * INPUT:  the Database wrapper + get/advance calls (characterId-scoped auto-write + tidy watermarks)
 * OUTPUT: createMemoryAutoRepo(db) -> { get, setEpisodic, setFlush, setTidy } over memory_auto_state
 * POS:    core/db — the auto-memory aggregate's typed SQL; upsert semantics; no node:sqlite import (uses the wrapper)
 */
import { z } from "zod";
import type { Database } from "./sqlite.ts";

export interface AutoState {
  lastEpisodicSeq: number;
  lastFlushSeq: number;
  /** When the tidy pass last completed for this character; null = never (batch 4). */
  lastTidyAt: string | null;
}

export interface MemoryAutoRepo {
  /** Current watermarks; zeros (and a null tidy mark) for a character that has never been summarized/flushed/tidied. */
  get(characterId: string): AutoState;
  /** Advance the episodic watermark (creating the row on first write). */
  setEpisodic(characterId: string, seq: number): void;
  /** Advance the flush watermark (creating the row on first write). */
  setFlush(characterId: string, seq: number): void;
  /** Advance the tidy watermark to an ISO timestamp (creating the row on first write). */
  setTidy(characterId: string, at: string): void;
}

const GET_SQL =
  "SELECT last_episodic_seq, last_flush_seq, last_tidy_at FROM memory_auto_state WHERE character_id = :characterId";

// One upsert per watermark: insert a fresh row (other columns keep their defaults) or bump only the target column.
const SET_EPISODIC_SQL =
  "INSERT INTO memory_auto_state (character_id, last_episodic_seq) VALUES (:characterId, :seq) " +
  "ON CONFLICT(character_id) DO UPDATE SET last_episodic_seq = excluded.last_episodic_seq";
const SET_FLUSH_SQL =
  "INSERT INTO memory_auto_state (character_id, last_flush_seq) VALUES (:characterId, :seq) " +
  "ON CONFLICT(character_id) DO UPDATE SET last_flush_seq = excluded.last_flush_seq";
const SET_TIDY_SQL =
  "INSERT INTO memory_auto_state (character_id, last_tidy_at) VALUES (:characterId, :at) " +
  "ON CONFLICT(character_id) DO UPDATE SET last_tidy_at = excluded.last_tidy_at";

const StateSchema = z.object({
  last_episodic_seq: z.int(),
  last_flush_seq: z.int(),
  last_tidy_at: z.string().nullable(),
});

export function createMemoryAutoRepo(db: Database): MemoryAutoRepo {
  const getState = db.prepare(GET_SQL);
  const setEpisodic = db.prepare(SET_EPISODIC_SQL);
  const setFlush = db.prepare(SET_FLUSH_SQL);
  const setTidy = db.prepare(SET_TIDY_SQL);

  return {
    get(characterId) {
      const row = getState.get({ characterId });
      if (!row) return { lastEpisodicSeq: 0, lastFlushSeq: 0, lastTidyAt: null };
      const parsed = StateSchema.parse(row);
      return {
        lastEpisodicSeq: parsed.last_episodic_seq,
        lastFlushSeq: parsed.last_flush_seq,
        lastTidyAt: parsed.last_tidy_at,
      };
    },
    setEpisodic: (characterId, seq) => void setEpisodic.run({ characterId, seq }),
    setFlush: (characterId, seq) => void setFlush.run({ characterId, seq }),
    setTidy: (characterId, at) => void setTidy.run({ characterId, at }),
  };
}
