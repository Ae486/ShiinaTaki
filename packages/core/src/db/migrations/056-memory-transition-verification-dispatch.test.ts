import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HindsightTransitionAcquireSchema, HindsightTransitionStatusSchema } from "@taki/shared";
import { openDatabase, type Database } from "../sqlite.ts";
import { runMigrations } from "../migration-runner.ts";
import { MIGRATIONS } from "./index-list.ts";
import { memoryTransitionVerificationDispatchMigration056 } from "./056-memory-transition-verification-dispatch.ts";
import { seedTransition, startTransition, TRANSITION_AT } from "../memory-transition-fixtures.ts";
import { initializeTransitionDriverBanks, prepareTransitionNativeCommand, markTransitionNativeDispatched,
  recordTransitionNativeObservation } from "../memory-transition-driver-repo.ts";
import { recordTransitionVerificationDispatch, hasTransitionVerificationDispatch } from "../memory-transition-verification-dispatch.ts";
import { signHindsightTransitionAcquire } from "../../memory/hindsight/hindsight-transition-proof.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

function acquire(db: Database) {
  const intent = seedTransition(db); const lease = startTransition(db, intent); const work = { lease, now: TRANSITION_AT };
  const bank = initializeTransitionDriverBanks(db, work)[0]!;
  const request = signHindsightTransitionAcquire(bank.nativeBankId, HindsightTransitionAcquireSchema.parse({
    transition_id: intent.transitionId, attempt_id: randomUUID(), provider_lineage: intent.request.expected.sourceLineageId,
    bank_generation: randomUUID(), direction: "return-local", request_hash: "0".repeat(64) }));
  const command = prepareTransitionNativeCommand(db, { ...work, command: { kind: "acquire", bankId: bank.nativeBankId, slot: "original", request } });
  markTransitionNativeDispatched(db, { ...work, command });
  const status = HindsightTransitionStatusSchema.parse({ bank_id: bank.nativeBankId, request,
    executor: { transition_id: intent.transitionId, attempt_id: request.attempt_id, generation: 1, fence_token: randomUUID() },
    revision: 2, phase: "fenced", lease_expires_at: "2026-09-29T00:01:00.000Z", executor_live: true,
    active_writers: 0, accepted_operations: 0, proof: null, outcome: null });
  recordTransitionNativeObservation(db, { ...work, status });
  return { ...work, status };
}

describe("056 immutable verification dispatch", () => {
  it("preserves recorded055 bytes, starts empty and retains a new dispatch across physical reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-056-")); const path = join(dir, "database.sqlite");
    let db = openDatabase({ path, migrations: MIGRATIONS.filter((migration) => migration.version <= 55) });
    try {
      const input = acquire(db); const old = db.prepare("SELECT * FROM memory_transition_native_commands").all();
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all(); db.close();
      db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare("SELECT * FROM memory_transition_native_commands").all()).toEqual(old);
      expect(db.prepare("SELECT * FROM migrations WHERE version<=55 ORDER BY version").all()).toEqual(receipts);
      expect(hasTransitionVerificationDispatch(db, input.lease.transitionId, input.status.bank_id)).toBe(false);
      recordTransitionVerificationDispatch(db, input); recordTransitionVerificationDispatch(db, input);
      const dispatched = db.prepare("SELECT * FROM memory_transition_native_verifications").all(); expect(dispatched).toHaveLength(1);
      db.close(); db = openDatabase({ path, migrations: MIGRATIONS });
      expect(db.prepare("SELECT * FROM memory_transition_native_verifications").all()).toEqual(dispatched);
      expect(hasTransitionVerificationDispatch(db, input.lease.transitionId, input.status.bank_id)).toBe(true);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); rmTempDir(dir); }
  });

  it("rejects update/delete/replace and invalid executor/hash evidence", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    try {
      const input = acquire(db); recordTransitionVerificationDispatch(db, input);
      const rows = db.prepare("SELECT * FROM memory_transition_native_verifications").all();
      expect(() => db.exec("UPDATE memory_transition_native_verifications SET dispatched_at='changed'")).toThrow("immutable");
      expect(() => db.exec("DELETE FROM memory_transition_native_verifications")).toThrow("immutable");
      expect(() => db.exec("INSERT OR REPLACE INTO memory_transition_native_verifications SELECT * FROM memory_transition_native_verifications")).toThrow("immutable");
      expect(db.prepare("SELECT * FROM memory_transition_native_verifications").all()).toEqual(rows);
      expect(() => recordTransitionVerificationDispatch(db, { ...input, status: { ...input.status,
        executor: { ...input.status.executor, fence_token: randomUUID() } } })).toThrow("PROOF_INVALID");
      expect(() => recordTransitionVerificationDispatch(db, { ...input, status: { ...input.status, executor_live: false } })).toThrow("PROOF_INVALID");
      db.prepare("INSERT INTO memory_transition_native_verifications VALUES(:id,:transition,:bank,2,:executor,:now)").run({
        id: "invalid", transition: input.lease.transitionId, bank: input.status.bank_id,
        executor: JSON.stringify({ ...input.status.executor, generation: 2 }), now: input.now });
      expect(() => hasTransitionVerificationDispatch(db, input.lease.transitionId, input.status.bank_id)).toThrow("PROOF_INVALID");
    } finally { db.close(); }
  });

  it.each(["sql-failure", "receipt-failure", "commit-failure"])("rolls back %s without rewriting055 receipts or commands", (failure) => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS.filter((migration) => migration.version <= 55) });
    try {
      acquire(db); const old = db.prepare("SELECT * FROM memory_transition_native_commands").all();
      const receipts = db.prepare("SELECT * FROM migrations ORDER BY version").all();
      if (failure === "receipt-failure") db.exec("CREATE TRIGGER fail_056 BEFORE INSERT ON migrations WHEN NEW.version=56 BEGIN SELECT RAISE(ABORT,'owned failure'); END");
      if (failure === "commit-failure") db.exec(`CREATE TABLE owned_parent(id TEXT PRIMARY KEY);
        CREATE TABLE owned_child(id TEXT REFERENCES owned_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_056 AFTER INSERT ON migrations WHEN NEW.version=56 BEGIN INSERT INTO owned_child VALUES('missing'); END`);
      const migration = failure === "sql-failure" ? { ...memoryTransitionVerificationDispatchMigration056,
        sql: memoryTransitionVerificationDispatchMigration056.sql + "INSERT INTO absent_owned_table VALUES(1);" } : memoryTransitionVerificationDispatchMigration056;
      expect(() => runMigrations(db, [migration])).toThrow();
      expect(db.prepare("SELECT * FROM migrations ORDER BY version").all()).toEqual(receipts);
      expect(db.prepare("SELECT * FROM memory_transition_native_commands").all()).toEqual(old);
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='memory_transition_native_verifications'").get()).toBeUndefined();
    } finally { db.close(); }
  });
});
