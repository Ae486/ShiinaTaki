import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { AT, seedHindsightAuthority } from "../operations/memory-operation-fixtures.ts";
import { HINDSIGHT_BACKUP_RECEIPT_MAP, readHindsightTerminalOperations } from "./hindsight-backup-receipts.ts";

const LINEAGE = "11111111-1111-4111-8111-111111111111";
const GEN = "33333333-3333-4333-8333-333333333333";
const OLD_GEN = "77777777-7777-4777-8777-777777777777";
const BANK = "taki-hs-c";
const hex = (character: string) => character.repeat(64);

const dirs: string[] = []; const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });

function database(): Database {
  const dir = mkdtempSync(join(tmpdir(), "taki-backup-receipts-")); dirs.push(dir);
  const db = openDatabase({ path: join(dir, "state.db"), migrations: MIGRATIONS }); dbs.push(db);
  seedHindsightAuthority(db);
  return db;
}

interface PendingSeed { remote: string; kind: "retain" | "edit" | "invalidate" | "restore"; protocol?: string; confirmed?: "nativeReceipt" | "nativeResultReceipt" | null; generation?: string }

function pending(db: Database, seed: PendingSeed): void {
  const state: Record<string, unknown> = { remoteOperationId: seed.remote, intent: { bankGeneration: seed.generation ?? GEN } };
  if (seed.protocol) state.dispatch = { protocol: seed.protocol };
  if (seed.confirmed !== null) state[seed.confirmed ?? "nativeReceipt"] = { at: AT };
  db.prepare(`INSERT INTO pending_memory (authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES ('epoch',:bank,:operation,:kind,:hash,'completed',1,:state)`)
    .run({ bank: BANK, operation: `op-${seed.remote}`, kind: seed.kind, hash: hex("c"), state: JSON.stringify(state) });
}

function applicationJob(db: Database, input: { operationId: string; state: "completed" | "refused" | "dispatched"; generation?: string; lineage?: string }): void {
  const settled = input.state !== "dispatched";
  db.prepare(`INSERT INTO hindsight_application_command_jobs (authority_epoch_id,bank_id,request_id,provider_lineage,bank_generation,application_id,
      operation_id,intent_bytes,intent_bytes_hash,intent_hash,request_bytes,request_bytes_hash,state,revision,prepared_at,dispatched_at,updated_at,
      receipt_bytes,receipt_bytes_hash)
    VALUES ('epoch',:bank,:request,:lineage,:generation,'taki',:operation,x'00',:hash,:hash,x'00',:hash,:state,1,:at,:at,:at,:receipt,:receiptHash)`)
    .run({ bank: BANK, request: `request-${input.operationId}`, lineage: input.lineage ?? LINEAGE, generation: input.generation ?? GEN,
      operation: input.operationId, hash: hex("d"), state: input.state, at: AT,
      receipt: settled ? new Uint8Array([1]) : null, receiptHash: settled ? hex("e") : null });
}

const read = (db: Database) => readHindsightTerminalOperations(db, { epochId: "epoch", providerLineageId: LINEAGE, generations: new Map([[BANK, GEN]]) });

describe("hindsight backup receipt mapping (ruling 3)", () => {
  it("pins every Core terminal write kind to its native proof", () => {
    expect(HINDSIGHT_BACKUP_RECEIPT_MAP.map((rule) => [rule.core, rule.native])).toEqual([
      ["pending tracked_native_v1 retain, native-confirmed", "memory_native_operation_receipts"],
      ["pending tracked_native_v1 edit/invalidate/restore, native-confirmed", "memory_native_operation_receipts"],
      ["pending legacy edit/invalidate/restore, native-confirmed", "memory_mutation_receipts"],
      ["pending legacy retain, native-confirmed", null],
      ["D77 application command job completed", "memory_application_operations"],
      ["D77 memory write intent completed (047)", null],
      ["ingestion span, outbox evidence", null],
      ["ingestion span, provider evidence", null],
      ["policy work request (045)", null],
      ["observed write", null],
      ["primary conversation witness", null],
      ["B2 original template Apply receipt, published", "memory_template_receipts"],
      ["B2 persisted semantic refresh-result marker claim", "memory_template_refresh_results"],
    ]);
    for (const rule of HINDSIGHT_BACKUP_RECEIPT_MAP) expect(rule.native === null).toBe(rule.id === null);
  });

  it("lists native-confirmed Pending of the current generation in the id format of its native receipt table", () => {
    const db = database();
    pending(db, { remote: "tracked-retain", kind: "retain", protocol: "tracked_native_v1" });
    pending(db, { remote: "tracked-edit", kind: "edit", protocol: "tracked_native_v1", confirmed: "nativeResultReceipt" });
    pending(db, { remote: "legacy-invalidate", kind: "invalidate" });
    pending(db, { remote: "legacy-retain", kind: "retain" });
    pending(db, { remote: "unconfirmed", kind: "retain", protocol: "tracked_native_v1", confirmed: null });
    pending(db, { remote: "old-generation", kind: "retain", protocol: "tracked_native_v1", generation: OLD_GEN });
    expect(read(db)).toEqual([
      `native-operation:${BANK}:${GEN}:retain:tracked-retain`,
      `native-operation:${BANK}:${GEN}:mutation:tracked-edit`,
      `mutation-receipt:${BANK}:legacy-invalidate`,
    ]);
  });

  it("lists completed D77 application jobs of this lineage and generation only", () => {
    const db = database();
    applicationJob(db, { operationId: "done", state: "completed" });
    applicationJob(db, { operationId: "refused", state: "refused" });
    applicationJob(db, { operationId: "in-flight", state: "dispatched" });
    applicationJob(db, { operationId: "old-generation", state: "completed", generation: OLD_GEN });
    applicationJob(db, { operationId: "other-lineage", state: "completed", lineage: "88888888-8888-4888-8888-888888888888" });
    expect(read(db)).toEqual([`application-operation:${LINEAGE}:${BANK}:${GEN}:done`]);
  });
});
