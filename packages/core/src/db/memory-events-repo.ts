/**
 * INPUT:  the Database wrapper + record/list calls (memory-system decision events)
 * OUTPUT: createMemoryEventsRepo(db) -> { record, listByCharacter }; MemoryEventKindSchema; MemoryEvent(Row)
 * POS:    core/db — the memory_events aggregate's typed SQL. Rows carry ids/counts/ranges ONLY (never memory content);
 *         diagnosis is a post-hoc SQL join by turn_seq, which is why this is a table and not a pino line.
 */
import { z } from "zod";
import type { Database } from "./sqlite.ts";

// Batch 1 kinds; batch 3 adds "search". Kind is plain TEXT in SQLite, so extending is one entry here.
export const MemoryEventKindSchema = z.enum(["skip", "reinforce"]);
export type MemoryEventKind = z.infer<typeof MemoryEventKindSchema>;

export interface MemoryEvent {
  kind: MemoryEventKind;
  characterId: string;
  /** The timeline seq this decision belongs to; absent when the write path has no turn context. */
  turnSeq?: number;
  entryId?: string;
}

export interface MemoryEventRow {
  id: number;
  kind: string;
  characterId: string;
  turnSeq: number | null;
  entryId: string | null;
  createdAt: string;
}

export interface MemoryEventsRepo {
  record(event: MemoryEvent): void;
  /** Newest first — the diagnosis read side (SQL joins by turn_seq live above this). */
  listByCharacter(params: { characterId: string; limit: number }): MemoryEventRow[];
}

const INSERT_SQL =
  "INSERT INTO memory_events (kind, character_id, turn_seq, entry_id, created_at) " +
  "VALUES (:kind, :characterId, :turnSeq, :entryId, :createdAt)";
const LIST_SQL =
  "SELECT id, kind, character_id, turn_seq, entry_id, created_at FROM memory_events " +
  "WHERE character_id = :characterId ORDER BY id DESC LIMIT :limit";

const RowSchema = z.object({
  id: z.int(),
  kind: z.string(),
  characterId: z.string(),
  turnSeq: z.int().nullable(),
  entryId: z.string().nullable(),
  createdAt: z.string(),
});

export function createMemoryEventsRepo(db: Database): MemoryEventsRepo {
  const insert = db.prepare(INSERT_SQL);
  const list = db.prepare(LIST_SQL);

  return {
    record({ kind, characterId, turnSeq, entryId }) {
      insert.run({
        kind,
        characterId,
        turnSeq: turnSeq ?? null,
        entryId: entryId ?? null,
        createdAt: new Date().toISOString(),
      });
    },
    listByCharacter({ characterId, limit }) {
      return list.all({ characterId, limit }).map((row) =>
        RowSchema.parse({
          id: row.id,
          kind: row.kind,
          characterId: row.character_id,
          turnSeq: row.turn_seq,
          entryId: row.entry_id,
          createdAt: row.created_at,
        }),
      );
    },
  };
}
