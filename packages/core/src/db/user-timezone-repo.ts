/**
 * INPUT: Core Database and validated revision-bound User Timezone replacements
 * OUTPUT: strict singleton reads and compare-and-swap writes preserving confirmation provenance
 * POS: core/db — sole user_timezone writer; the owning service supplies the schedule transaction
 */
import { UserTimezoneStateSchema, type UserTimezoneState } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface UserTimezoneRepo {
  read(): UserTimezoneState;
  replace(state: UserTimezoneState, expectedRevision: number): boolean;
}

export function createUserTimezoneRepo(db: Database): UserTimezoneRepo {
  return {
    read() {
      const row = db.prepare(`SELECT timezone, mode, authority_device_id, revision, updated_at,
        confirmed_at, source, source_device_id FROM user_timezone WHERE singleton_id=1`).get();
      if (!row) throw new Error("User Timezone singleton is missing");
      return UserTimezoneStateSchema.parse({
        timezone: row.timezone, mode: row.mode, authorityDeviceId: row.authority_device_id,
        revision: row.revision, updatedAt: row.updated_at, confirmedAt: row.confirmed_at,
        source: row.source, sourceDeviceId: row.source_device_id,
      });
    },
    replace(candidate, expectedRevision) {
      const state = UserTimezoneStateSchema.parse(candidate);
      if (state.revision !== expectedRevision + 1) throw new Error("User Timezone revision must advance once");
      const result = db.prepare(`UPDATE user_timezone SET timezone=:timezone, mode=:mode,
        authority_device_id=:authorityDeviceId, revision=:revision, updated_at=:updatedAt,
        confirmed_at=:confirmedAt, source=:source, source_device_id=:sourceDeviceId
        WHERE singleton_id=1 AND revision=:expectedRevision`).run({ ...state, expectedRevision });
      return result.changes === 1;
    },
  };
}
