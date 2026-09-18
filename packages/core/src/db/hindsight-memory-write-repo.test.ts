import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { hindsightApplicationWireJson } from "@taki/shared";
import { memoryWriteFixture, writeTestBank, writeTestMetadata, writeTestRetain, WRITE_TEST_MEMORY,
  type MemoryWriteFixture } from "../memory/hindsight/hindsight-memory-write-fixtures.ts";
import { readHindsightMemoryWriteTarget } from "../memory/hindsight/hindsight-memory-write-context.ts";

const fixtures: MemoryWriteFixture[] = []; const directories: string[] = [];
const ownedRuntime = resolve("H:/TakiAgent/.trellis/.runtime/b6-continuation-20260911");
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== ownedRuntime || !basename(directory).startsWith("write-repo-")) throw new Error("unsafe owned fixture path");
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(input: Parameters<typeof memoryWriteFixture>[0] = {}) {
  const result = memoryWriteFixture(input); fixtures.push(result); return result;
}
function target(f: MemoryWriteFixture) {
  return readHindsightMemoryWriteTarget(f.deps, { ...f.bank.scope, memoryId: WRITE_TEST_MEMORY })!;
}
function prepare(f: MemoryWriteFixture, requestId = "write-a") {
  return f.journal.prepare({ identity: f.identity(requestId), nativeOperationId: null, target: target(f) });
}

describe("D77 whole-write journal with real SQLite", () => {
  it("keeps the first target and stable terminal result through duplicate requests and a database reopen", async () => {
    const directory = mkdtempSync(join(ownedRuntime, "write-repo-")); directories.push(directory);
    const path = join(directory, "fixture.sqlite"); const bank = writeTestBank({ metadata: writeTestMetadata(10_000, true) });
    const f = fixture({ path, bank }); const original = prepare(f);
    const captured = hindsightApplicationWireJson(original.target);
    f.base.clock.at = "2026-09-11T08:01:00.000Z";
    const changedTarget = { ...target(f), record: { ...target(f).record, unit: { ...target(f).record.unit, text: "Later candidate" } } };
    const duplicate = f.journal.prepare({ identity: f.identity(), nativeOperationId: "replacement-child", target: changedTarget });
    expect(duplicate.revision).toBe(original.revision); expect(duplicate.updatedAt).toBe(original.updatedAt);
    expect(duplicate.nativeOperationId).toBeNull(); expect(hindsightApplicationWireJson(duplicate.target)).toBe(captured);
    const command = { ...original.identity.key, requestId: "policy-a" };
    const application = f.journal.application({ key: original.identity.key, revision: original.revision, command });
    expect(application.revision).toBe(2);
    expect(f.journal.application({ key: original.identity.key, revision: 1, command }).revision).toBe(2);
    const terminal = { kind: "mutation" as const, result: { outcome: "applied" as const, record: original.target!.record } };
    const finished = f.journal.finish({ key: original.identity.key, revision: application.revision, terminal });
    expect(finished.revision).toBe(3);
    expect(f.journal.finish({ key: original.identity.key, revision: 1, terminal }).revision).toBe(3);
    await f.close();
    const reopened = fixture({ path, bank }); const restored = reopened.journal.get(original.identity.key)!;
    expect(restored.revision).toBe(3); expect(hindsightApplicationWireJson(restored.target)).toBe(captured);
    expect(hindsightApplicationWireJson(restored.terminal)).toContain('"__proto__":{"data":[false,null,3]}');
    expect(reopened.journal.pending({ authorityEpochId: "epoch", bankId: bank.scope.bankId })).toEqual([]);
    const replay = reopened.journal.prepare({ identity: f.identity(), nativeOperationId: null, target: null });
    expect(hindsightApplicationWireJson(replay.terminal)).toBe(hindsightApplicationWireJson(restored.terminal));
  });

  it("rejects changed requests, actor changes, namespace mismatch and an unowned epoch without altering the first row", () => {
    const f = fixture(); const first = prepare(f); const bytes = hindsightApplicationWireJson(first);
    const changed = f.identity();
    if (changed.operation.kind !== "mutation" || changed.operation.request.kind !== "edit") throw new Error("fixture kind");
    changed.operation.request.patch.layerId = "preferences";
    expect(() => f.journal.prepare({ identity: changed, nativeOperationId: null, target: target(f) })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
    expect(() => f.journal.prepare({ identity: { ...f.identity(), actor: "operator" }, nativeOperationId: null, target: target(f) })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
    for (const identity of [
      { ...f.identity(), namespace: { ...f.bank.scope.namespace, bank_generation: "55555555-5555-4555-8555-555555555555" } },
      { ...f.identity(), key: { ...first.identity.key, authorityEpochId: "unowned" } },
    ]) expect(() => f.journal.prepare({ identity, nativeOperationId: null, target: target(f) })).toThrow(/AUTHORITY/);
    expect(hindsightApplicationWireJson(f.journal.get(first.identity.key))).toBe(bytes);
  });

  it("uses real revision CAS and immutable evidence, preserving more than 256 result references", () => {
    const f = fixture(); const identity = { ...f.identity(), operation: { kind: "retain" as const,
      request: writeTestRetain(f.route.bankId), zeroResultAllowed: true } };
    const job = f.journal.prepare({ identity, nativeOperationId: "native-child", target: null });
    const memories = Array.from({ length: 513 }, (_, index) => ({ memoryId: `memory-${index}`, revision: index + 1 }));
    const value = { resultHash: "a".repeat(64), memories };
    const saved = f.journal.references({ key: identity.key, revision: job.revision, value });
    expect(saved.references?.memories).toEqual(memories);
    expect(() => f.journal.references({ key: identity.key, revision: saved.revision, value: { ...value, resultHash: "b".repeat(64) } })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
    const terminal = { kind: "retain" as const, result: { status: "completed" as const, documentId: "source-a", sourceRevision: 7, memories } };
    expect(() => f.journal.finish({ key: identity.key, revision: job.revision, terminal })).toThrow("MEMORY_REVISION_MISMATCH");
    expect(f.journal.get(identity.key)?.terminal).toBeNull();
    const complete = f.journal.finish({ key: identity.key, revision: saved.revision, terminal });
    expect(complete.terminal?.kind === "retain" && complete.terminal.result.memories).toEqual(memories);
    expect(() => f.journal.finish({ key: identity.key, revision: complete.revision,
      terminal: { ...terminal, result: { ...terminal.result, sourceRevision: 8 } } })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
  });

  it("rolls back an actual deferred COMMIT failure and leaves subsequent transactions usable", () => {
    const f = fixture();
    f.base.db.exec(`CREATE TABLE write_test_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE write_test_child (id INTEGER REFERENCES write_test_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER write_test_fail AFTER INSERT ON hindsight_memory_write_intents
      BEGIN INSERT INTO write_test_child(id) VALUES(1); END;`);
    expect(() => prepare(f)).toThrow(/FOREIGN KEY/);
    expect(f.base.db.prepare("SELECT COUNT(*) AS count FROM hindsight_memory_write_intents").get()?.count).toBe(0);
    expect(f.base.db.prepare("SELECT COUNT(*) AS count FROM write_test_child").get()?.count).toBe(0);
    f.base.db.exec("DROP TRIGGER write_test_fail");
    expect(prepare(f).revision).toBe(1);
  });

  it("rolls back a post-update authority failure and refuses an active-epoch change", () => {
    const f = fixture(); const job = prepare(f);
    f.control.extraGuard = () => {
      if (f.base.db.prepare("SELECT 1 FROM hindsight_memory_write_intents WHERE revision>1").get()) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    };
    expect(() => f.journal.application({ key: job.identity.key, revision: 1,
      command: { ...job.identity.key, requestId: "policy-a" } })).toThrow("MEMORY_AUTHORITY_MISMATCH");
    f.control.extraGuard = undefined;
    expect(f.journal.get(job.identity.key)?.revision).toBe(1); expect(f.journal.get(job.identity.key)?.applicationKey).toBeNull();
    f.base.db.transaction(() => {
      f.base.db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:at WHERE epoch_id='epoch'").run({ at: f.base.clock.at });
      f.base.db.prepare(`INSERT INTO canonical_memory_authority_epochs
        (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
        VALUES ('new-epoch','hindsight',:lineage,'active','epoch',:at,NULL,'planned-switch')`)
        .run({ lineage: f.bank.scope.namespace.provider_lineage, at: f.base.clock.at });
      f.base.db.exec("UPDATE canonical_memory_authority_state SET active_epoch_id='new-epoch' WHERE singleton=1");
    });
    expect(() => f.journal.get(job.identity.key)).toThrow(/AUTHORITY/);
    expect(() => f.journal.pending({ authorityEpochId: "epoch", bankId: f.route.bankId })).toThrow(/AUTHORITY/);
  });

  it("rejects corrupted stored bytes and contradictory terminal identity", () => {
    const f = fixture(); const job = prepare(f);
    const wrong = target(f).record; const other = { ...wrong, unit: { ...wrong.unit, memoryId: "other" }, policy: { ...wrong.policy, memoryId: "other" } };
    expect(() => f.journal.finish({ key: job.identity.key, revision: job.revision,
      terminal: { kind: "mutation", result: { outcome: "applied", record: other } } })).toThrow(/identity/);
    expect(f.journal.get(job.identity.key)?.terminal).toBeNull();
    f.base.db.prepare("UPDATE hindsight_memory_write_intents SET payload_bytes=:bytes WHERE request_id=:request")
      .run({ bytes: new Uint8Array([123, 125]), request: job.identity.key.requestId });
    expect(() => f.journal.get(job.identity.key)).toThrow("MEMORY_INTEGRITY_ERROR");
  });

  it("keeps ordered pagination and rejects a second parent claiming the same native child", () => {
    const f = fixture(); const first = f.journal.prepare({ identity: f.identity("a"), nativeOperationId: "native-a", target: target(f) });
    expect(() => f.journal.prepare({ identity: f.identity("b"), nativeOperationId: "native-a", target: target(f) })).toThrow(/UNIQUE/);
    const second = prepare(f, "b"); const third = prepare(f, "c");
    expect(f.journal.ownsNativeMutation({ authorityEpochId: "epoch", operationId: "native-a" })).toBe(true);
    expect(f.journal.pending({ authorityEpochId: "epoch", bankId: f.route.bankId, limit: 1 })[0]?.sequence).toBe(first.sequence);
    expect(f.journal.pending({ authorityEpochId: "epoch", bankId: f.route.bankId, afterSequence: first.sequence }).map((row) => row.sequence)).toEqual([second.sequence, third.sequence]);
  });
});
