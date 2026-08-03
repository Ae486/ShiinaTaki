/**
 * INPUT:  the Database wrapper + get/all/upsert/delete calls keyed by knob name
 * OUTPUT: createConfigRepo(db) -> { get, all, upsert, delete } over the sparse config table
 * POS:    core/db — the settings store's typed SQL (#26 batch 1). Rows hold ONE JSON primitive each; a row that no
 *         longer parses is a THROW at the repo boundary, never a silently dropped setting
 */
import { z } from "zod";
import { ConfigValueSchema, type ConfigValue } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface ConfigRepo {
  /** The stored value, or null when the operator never set this knob (env/default then governs). */
  get(key: string): ConfigValue | null;
  /** Every stored knob, keyed by name — the sparse overlay the config source resolves through. */
  all(): Map<string, ConfigValue>;
  upsert(key: string, value: ConfigValue): void;
  /** Reset: drop the operator's value so env/default takes over again. */
  delete(key: string): void;
}

const GET_SQL = "SELECT value FROM config WHERE key = :key";
const ALL_SQL = "SELECT key, value FROM config";
const UPSERT_SQL =
  "INSERT INTO config (key, value, updated_at) VALUES (:key, :value, :updatedAt) " +
  "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";
const DELETE_SQL = "DELETE FROM config WHERE key = :key";

const RowSchema = z.object({ key: z.string(), value: z.string() });
const ValueRowSchema = RowSchema.omit({ key: true });

// The column is TEXT holding JSON. Anything that does not decode into a JSON primitive is corruption, and a config
// store that quietly ignores a corrupt row would boot the agent on values the operator never chose.
function decode(key: string, raw: string): ConfigValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config row ${key} is not valid JSON`);
  }
  const value = ConfigValueSchema.safeParse(parsed);
  if (!value.success) throw new Error(`config row ${key} is not a JSON primitive`);
  return value.data;
}

export function createConfigRepo(db: Database): ConfigRepo {
  const getRow = db.prepare(GET_SQL);
  const allRows = db.prepare(ALL_SQL);
  const upsertRow = db.prepare(UPSERT_SQL);
  const deleteRow = db.prepare(DELETE_SQL);

  return {
    get(key) {
      const row = getRow.get({ key });
      if (!row) return null;
      return decode(key, ValueRowSchema.parse(row).value);
    },
    all() {
      const entries = new Map<string, ConfigValue>();
      for (const row of allRows.all()) {
        const parsed = RowSchema.parse(row);
        entries.set(parsed.key, decode(parsed.key, parsed.value));
      }
      return entries;
    },
    upsert(key, value) {
      upsertRow.run({ key, value: JSON.stringify(value), updatedAt: new Date().toISOString() });
    },
    delete(key) {
      deleteRow.run({ key });
    },
  };
}
