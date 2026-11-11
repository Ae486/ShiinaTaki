import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryReplicaRequestSchema } from "@taki/shared";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { readReplicaRequest } from "../hindsight-replica-request-repo.ts";
import { runMigrations } from "../migration-runner.ts";
import { openDatabase } from "../sqlite.ts";
import { MIGRATIONS } from "./index-list.ts";
import { hindsightReplicaWaitingMigration063 } from "./063-hindsight-replica-waiting.ts";

const at = "2026-11-11T00:00:00.000Z";
const oldMigrations = MIGRATIONS.filter((migration) => migration.version <= 62);
const rowsSql = "SELECT rowid,* FROM hindsight_replica_manual_requests ORDER BY rowid";

describe("063 terminal replica waiting", () => {
  it("preserves every historical ID/state/JSON byte and receipt while adding immutable waiting through actual reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-063-")); const path = join(directory, "core.sqlite");
    let db = openDatabase({ path, migrations: oldMigrations });
    try {
      db.prepare(`INSERT INTO canonical_memory_authority_epochs(epoch_id,provider_id,provider_lineage_id,status,started_at,reason)
        VALUES ('source','hindsight','lineage','active',:at,'planned-switch')`).run({ at });
      db.prepare(`INSERT INTO memory_operations(operation_id,kind,family,state,request_json,owner_boot_id,created_at,updated_at,terminal_at)
        VALUES ('emergency','transition.emergency-local','memory-transition','completed','{}','previous',:at,:at,:at)`).run({ at });
      const claim = { bankId: "global", ownerId: "previous", runId: randomUUID(), fence: 1, expiresAt: at };
      const base = { requestId: randomUUID(), bankId: "global", kind: "full", state: "waiting", claim,
        createdAt: at, settledAt: at, errorCode: null, nextAction: "explicit_retry_required", lastSuccessAt: null };
      for (const state of ["queued", "claimed", "succeeded", "failed", "cancelled"] as const) {
        const row = MemoryReplicaRequestSchema.parse({ ...base, requestId: randomUUID(), state,
          claim: state === "queued" || state === "cancelled" ? null : claim,
          settledAt: state === "queued" || state === "claimed" ? null : at,
          errorCode: state === "failed" ? "HINDSIGHT_TIMEOUT" : null,
          nextAction: state === "failed" ? "explicit_retry_required" : null, lastSuccessAt: state === "succeeded" ? at : null });
        db.prepare("INSERT INTO hindsight_replica_manual_requests VALUES (:id,'global',:state,:json)")
          .run({ id: row.requestId, state, json: JSON.stringify(row, null, 2) });
      }
      const original = db.prepare(rowsSql).all(); const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      const quarantinedId = String(original[0]!.request_id);
      db.prepare("INSERT INTO memory_transition_emergency_manual_quarantine VALUES (:id,'emergency','source','original bytes',:at)")
        .run({ id: quarantinedId, at });
      const quarantine = db.prepare("SELECT rowid,* FROM memory_transition_emergency_manual_quarantine").all();
      const transitionSchemaSql = "SELECT type,name,sql FROM sqlite_schema WHERE name LIKE 'memory_transition%' ORDER BY name";
      const transitionSchema = db.prepare(transitionSchemaSql).all();
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare(rowsSql).all()).toEqual(original);
      expect(db.prepare("SELECT rowid,* FROM memory_transition_emergency_manual_quarantine").all()).toEqual(quarantine);
      expect(db.prepare(transitionSchemaSql).all()).toEqual(transitionSchema);
      expect(() => db.prepare("UPDATE hindsight_replica_manual_requests SET state='claimed' WHERE request_id=:id").run({ id: quarantinedId }))
        .toThrow("HINDSIGHT_REPLICA_SCHEDULE_STALE");
      expect(() => db.exec("DELETE FROM memory_transition_emergency_manual_quarantine")).toThrow("immutable emergency manual quarantine");
      expect(() => db.exec("UPDATE memory_transition_emergency_manual_quarantine SET original_hash='changed'")).toThrow("immutable emergency manual quarantine");
      expect(db.prepare("SELECT * FROM migrations WHERE version<=62 ORDER BY version").all()).toEqual(receipts);
      const waiting = MemoryReplicaRequestSchema.parse(base);
      db.prepare("INSERT INTO hindsight_replica_manual_requests VALUES (:id,'global','waiting',:json)")
        .run({ id: waiting.requestId, json: JSON.stringify(waiting) });
      for (const state of ["succeeded", "failed", "cancelled", "waiting"]) {
        expect(() => db.prepare("UPDATE hindsight_replica_manual_requests SET state_json='{}' WHERE state=:state").run({ state }))
          .toThrow("HINDSIGHT_REPLICA_REQUEST_TERMINAL");
      }
      expect(() => db.exec("DELETE FROM hindsight_replica_manual_requests")).toThrow("HINDSIGHT_REPLICA_REQUEST_IMMUTABLE");
      expect(() => db.exec("INSERT INTO hindsight_replica_manual_requests VALUES ('duplicate','global','queued','{}')")).toThrow("UNIQUE");
      expect(() => db.exec("INSERT INTO hindsight_replica_manual_requests VALUES ('invalid','global','invented','{}')")).toThrow("CHECK");
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(readReplicaRequest(db, waiting.requestId)).toEqual(waiting);
      expect(db.prepare(rowsSql).all().slice(0, original.length)).toEqual(original);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(db.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok");
      db.exec("UPDATE memory_operations SET terminal_at=NULL WHERE operation_id='emergency'");
      expect(() => db.exec("INSERT INTO hindsight_replica_manual_requests VALUES ('blocked','other','queued','{}')")).toThrow("MEMORY_OPERATION_BUSY");
    } finally { db.close(); rmTempDir(directory); }
  });

  it("rolls table replacement and trigger changes back if the migration receipt cannot commit", () => {
    const db = openDatabase({ path: ":memory:", migrations: oldMigrations });
    try {
      db.exec("INSERT INTO hindsight_replica_manual_requests VALUES ('old-failure','global','failed','{ \"historical\": true }')");
      const schema = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name LIKE 'hindsight_replica_manual_requests%' ORDER BY name").all();
      const rows = db.prepare(rowsSql).all();
      db.exec("CREATE TRIGGER fail_063 BEFORE INSERT ON migrations WHEN NEW.version=63 BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
      expect(() => runMigrations(db, [hindsightReplicaWaitingMigration063])).toThrow("migration 63 failed");
      expect(db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name LIKE 'hindsight_replica_manual_requests%' ORDER BY name").all()).toEqual(schema);
      expect(db.prepare(rowsSql).all()).toEqual(rows);
      expect(() => db.exec("UPDATE hindsight_replica_manual_requests SET state_json='{}'")).toThrow("HINDSIGHT_REPLICA_REQUEST_TERMINAL");
      expect(db.prepare("SELECT max(version) AS version FROM migrations").get()?.version).toBe(62);
    } finally { db.close(); }
  });
});
