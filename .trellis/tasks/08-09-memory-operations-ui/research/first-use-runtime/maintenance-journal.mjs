/** Read scalar journal metadata only. Run after the replay stops; never select body/prompt/result bytes. */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function readMaintenanceJournal(root, start) {
  const path = join(root, "core-data/taki.db");
  if (existsSync(`${path}-wal`) && statSync(`${path}-wal`).size) {
    return { status: "UNKNOWN", reason: "Nonempty WAL; wait for the owned replay to stop before analyzing" };
  }
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare(`
      SELECT w.bank_id, w.work_id, w.work_kind, w.state, w.last_failure,
             w.created_at, w.updated_at, w.finished_at, w.command_request_id,
             j.state AS command_state, j.prepared_at, j.dispatched_at,
             j.updated_at AS command_updated_at
      FROM hindsight_policy_work w LEFT JOIN hindsight_application_command_jobs j
        ON j.authority_epoch_id=w.authority_epoch_id AND j.bank_id=w.bank_id
       AND j.request_id=w.command_request_id
      WHERE w.created_at>=? OR w.updated_at>=? ORDER BY w.created_at
    `).all(start, start);
    return { status: "read-only", rows };
  } catch { return { status: "FAILED", reason: "Journal read failed; no empty-result substitution" }; }
  finally { db?.close(); }
}
