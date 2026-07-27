/**
 * INPUT:  the Database wrapper + load/save calls carrying the pause snapshot (paused + absolute epoch-ms deadline)
 * OUTPUT: createPrivacyPauseRepo(db) -> { load, save } over privacy_pause_state (the perception PrivacyPauseStore seam)
 * POS:    core/db — the Privacy Pause aggregate's typed SQL; one row (id = 1), zod-parsed at the boundary; no
 *         node:sqlite import. The DB is the pause's home because the core is the single writer (invariant 2) and a
 *         row sidesteps the fs-write:self-escalation floor a policy FILE would raise.
 */
import type { PerceptionPauseState } from "@taki/shared";
import { z } from "zod";
import type { Database } from "./sqlite.ts";

export interface PrivacyPauseRepo {
  /** The persisted snapshot, or undefined for a core that has never been paused. */
  load(): PerceptionPauseState | undefined;
  save(state: PerceptionPauseState): void;
}

const LOAD_SQL = "SELECT paused, until FROM privacy_pause_state WHERE id = 1";
const SAVE_SQL =
  "INSERT INTO privacy_pause_state (id, paused, until) VALUES (1, :paused, :until) " +
  "ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, until = excluded.until";

// SQLite has no boolean: 0/1 in, boolean out. A row that fails this parse is a tampered/corrupt store — it throws at
// boot rather than silently resuming observation, which is the one degradation a consent withdrawal must not have.
const RowSchema = z.object({ paused: z.int(), until: z.int().positive().nullable() });

export function createPrivacyPauseRepo(db: Database): PrivacyPauseRepo {
  const load = db.prepare(LOAD_SQL);
  const save = db.prepare(SAVE_SQL);

  return {
    load() {
      const row = load.get();
      if (!row) return undefined;
      const parsed = RowSchema.parse(row);
      return { paused: parsed.paused !== 0, until: parsed.until };
    },
    save: (state) => void save.run({ paused: state.paused ? 1 : 0, until: state.until }),
  };
}
