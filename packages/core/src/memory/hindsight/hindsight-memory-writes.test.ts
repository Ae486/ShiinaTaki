import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { hindsightApplicationWireJson, type MutationRequest } from "@taki/shared";
import { memoryWriteFixture, readWriteSourceCommand, writeTestBank, writeTestCall, writeTestMetadata,
  writeTestRetain, WRITE_TEST_MEMORY, type MemoryWriteFixture } from "./hindsight-memory-write-fixtures.ts";
import { curatorTestRemotePolicy } from "./hindsight-policy-curator-fixtures.ts";
import { publishWriteNativeDeletion, publishWriteNativeMemory } from "./hindsight-memory-write-native-fixtures.ts";

const fixtures: MemoryWriteFixture[] = []; const directories: string[] = [];
const ownedRuntime = resolve(tmpdir());
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== ownedRuntime || !basename(directory).startsWith("write-gateway-")) throw new Error("unsafe owned fixture path");
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(input: Parameters<typeof memoryWriteFixture>[0] = {}) {
  const result = memoryWriteFixture(input); fixtures.push(result); return result;
}
function mutation(f: MemoryWriteFixture, combined = false): MutationRequest {
  return { kind: "edit", bankId: f.route.bankId, memoryId: WRITE_TEST_MEMORY, expectedRevision: 1,
    patch: { layerId: "profile", ...(combined ? { text: "Changed native fact" } : {}) } };
}
function parent(f: MemoryWriteFixture, id = "write-a") {
  return f.journal.get({ authorityEpochId: "epoch", bankId: f.route.bankId, requestId: id })!;
}
function child(f: MemoryWriteFixture, id = "write-a") {
  return f.pending.get({ authorityEpochId: "epoch", bankId: f.route.bankId, operationId: parent(f, id).nativeOperationId! })!;
}
function count(f: MemoryWriteFixture, table: "pending_memory" | "hindsight_memory_write_intents" | "hindsight_application_command_jobs") {
  return Number(f.base.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe("D77 whole-write gateway and recovery", () => {
  it("durably prepares the parent, native child and exact Source bytes before any native dispatch", async () => {
    const f = fixture(); const request = writeTestRetain(f.route.bankId, writeTestMetadata(200));
    const result = await f.writes.retain(f.call(), request);
    expect(result).toMatchObject({ status: "pending", sourceRevision: null, memories: [] });
    expect(count(f, "pending_memory")).toBe(1); expect(count(f, "hindsight_memory_write_intents")).toBe(1);
    expect(count(f, "hindsight_application_command_jobs")).toBe(1); expect(f.native.calls).toEqual([]);
    const source = readWriteSourceCommand(f);
    expect(source.job.state).toBe("prepared"); expect(source.source.bytes).toEqual(source.encoded.bytes);
    if (source.source.content.body_schema !== "application-source.v1") throw new Error("fixture kind");
    expect(hindsightApplicationWireJson(source.source.content.value.original_source.metadata)).toBe(hindsightApplicationWireJson(request.metadata));
    expect(source.source.content.value.original_witness).toBeNull();
    expect(source.source.content.value.original_source.retainedText).toBe(request.content);
    expect(source.source.content.value.operation_id).toBe(source.row.remoteOperationId);
    const repeat = await f.writes.retain(f.call(), request);
    expect(repeat).toEqual(result); expect(count(f, "pending_memory")).toBe(1);
    await expect(f.writes.retain(f.call(), { ...request, content: "Changed original source" })).rejects.toThrow("MEMORY_REQUEST_ID_CONFLICT");
  });

  it("keeps a normalized recovery availability error pending while propagating unknown plain errors", async () => {
    const f = fixture(); const request = writeTestRetain();
    f.control.beforeRecovery = async () => { throw new Error("HINDSIGHT_UNREACHABLE"); };
    expect(await f.writes.retain(f.call(), request)).toMatchObject({ status: "pending", sourceRevision: null, memories: [] });
    expect(parent(f).terminal).toBeNull(); expect(child(f).phase).toBe("queued"); expect(f.native.calls).toEqual([]);
    f.control.beforeRecovery = async () => { throw new Error("unclassified recovery defect"); };
    await expect(f.writes.retain(f.call(), request)).rejects.toThrow("unclassified recovery defect");
    expect(parent(f).terminal).toBeNull(); expect(count(f, "pending_memory")).toBe(1);
    expect(count(f, "hindsight_memory_write_intents")).toBe(1);
  });

  it("rolls back every intent on native preflight overflow or an application outbox failure", async () => {
    const native = fixture();
    // The raw Pending intent is below its own byte cap. Encoding nested typed metadata as native JSON
    // strings adds escaping and exceeds the independent tracked-native request cap only after enqueue.
    const metadata = { data: Array.from({ length: 256 }, () => Object.fromEntries(Array.from({ length: 200 }, (_, index) => [String(index), ""]))) };
    await expect(native.writes.retain(native.call(), writeTestRetain(native.route.bankId, metadata))).rejects.toThrow("HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED");
    for (const table of ["pending_memory", "hindsight_memory_write_intents", "hindsight_application_command_jobs"] as const) expect(count(native, table)).toBe(0);
    expect(native.native.calls).toEqual([]);
    const source = fixture();
    source.base.db.exec(`CREATE TRIGGER fail_source_outbox BEFORE INSERT ON hindsight_application_command_jobs
      BEGIN SELECT RAISE(ABORT, 'source outbox fixture failure'); END;`);
    await expect(source.writes.retain(source.call(), writeTestRetain())).rejects.toThrow("source outbox fixture failure");
    for (const table of ["pending_memory", "hindsight_memory_write_intents", "hindsight_application_command_jobs"] as const) expect(count(source, table)).toBe(0);
    expect(source.native.calls).toEqual([]);
  });

  it("applies a pure layer edit through actual app bytes with no native command, and preserves a later no-op", async () => {
    const f = fixture(); const request = mutation(f);
    const result = await f.writes.mutate(f.call(), request);
    expect(result).toMatchObject({ outcome: "applied", record: { unit: { revision: 1 }, policy: { layerId: "profile", policyVersion: 2 } } });
    expect(parent(f).nativeOperationId).toBeNull(); expect(count(f, "pending_memory")).toBe(0); expect(f.native.calls).toEqual([]);
    const job = f.base.writer.get(parent(f).applicationKey!)!;
    expect(job.state).toBe("completed"); expect(f.base.writer.applied(job)).toBe(true);
    const before = f.bank.server.calls.length;
    const unchanged = await f.writes.mutate(f.call("noop"), request);
    expect(unchanged).toMatchObject({ outcome: "unchanged" });
    expect(f.bank.server.calls.length).toBe(before); expect(count(f, "pending_memory")).toBe(0);
    await expect(f.writes.mutate(f.call(), { ...request, patch: { layerId: "preferences" } } as MutationRequest)).rejects.toThrow("MEMORY_REQUEST_ID_CONFLICT");
  });

  it("keeps a compound parent pending after G1 completion until its exact policy event is applied", async () => {
    const f = fixture(); f.control.replayNative = true; f.control.pullPolicy = false;
    const request = mutation(f, true); const first = await f.writes.mutate(f.call(), request);
    expect(first).toMatchObject({ outcome: "pending", record: null, pending: { phase: "awaiting_pull", operation: { request } } });
    expect(child(f).phase).toBe("completed"); expect(child(f).nativeResultReceipt?.result.mutation?.revision).toBe(2);
    const nativeOperation = child(f).intent.operation;
    expect(nativeOperation.kind === "mutation" && nativeOperation.request.kind === "edit"
      && nativeOperation.request.patch).toEqual({ text: "Changed native fact" });
    expect(f.writes.ownsPendingOperation(child(f).intent.operationId)).toBe(true);
    expect(f.writes.mutationOverlays(f.route.bankId)[0]?.operation.request).toEqual(request);
    const command = f.base.writer.get(parent(f).applicationKey!)!;
    expect(command.state).toBe("completed"); expect(f.base.writer.applied(command)).toBe(false); expect(parent(f).terminal).toBeNull();
    f.control.pullPolicy = true;
    const complete = await f.writes.mutate(f.call(), request);
    expect(complete).toMatchObject({ outcome: "applied", record: { unit: { revision: 2, text: "Changed native fact" }, policy: { layerId: "profile" } } });
    expect(f.base.writer.applied(f.base.writer.get(parent(f).applicationKey!)!)).toBe(true);
    expect(f.native.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
    expect(await f.writes.mutate(f.call(), request)).toEqual(complete); expect(f.writes.mutationOverlays(f.route.bankId)).toEqual([]);
  });

  it.each(["native", "application"] as const)("recovers a lost %s ACK without dispatching a different command", async (side) => {
    const f = fixture(); f.control.replayNative = true;
    if (side === "native") f.native.control.loseAck = true; else f.control.loseApplicationAck = true;
    const request = mutation(f, true); const first = await f.writes.mutate(f.call(), request);
    expect(first.outcome).toBe("pending"); expect(parent(f).terminal).toBeNull();
    const nativeId = child(f).remoteOperationId;
    const complete = await f.writes.mutate(f.call(), request);
    expect(complete).toMatchObject({ outcome: "applied", record: { unit: { revision: 2 }, policy: { layerId: "profile" } } });
    expect(child(f).remoteOperationId).toBe(nativeId);
    expect(f.native.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
    expect(f.bank.server.calls.filter((call) => call.startsWith("commit:"))).toHaveLength(1);
  });

  it("resumes a persisted compound parent after restart from its existing G1 and application receipt identities", async () => {
    const directory = mkdtempSync(join(ownedRuntime, "write-gateway-")); directories.push(directory);
    const path = join(directory, "fixture.sqlite"); const bank = writeTestBank();
    const first = fixture({ path, bank }); first.control.replayNative = true; first.control.loseApplicationAck = true;
    const request = mutation(first, true);
    expect((await first.writes.mutate(first.call(), request)).outcome).toBe("pending");
    const key = parent(first).applicationKey!; const nativeOperation = child(first).remoteOperationId;
    expect(child(first).phase).toBe("completed");
    await first.close();
    const reopened = fixture({ path, bank }); reopened.control.replayNative = true;
    const result = await reopened.writes.mutate(reopened.call(), request);
    expect(result).toMatchObject({ outcome: "applied", record: { unit: { revision: 2 }, policy: { layerId: "profile" } } });
    expect(parent(reopened).applicationKey).toEqual(key); expect(child(reopened).remoteOperationId).toBe(nativeOperation);
    expect(reopened.native.calls.filter((call) => call.startsWith("dispatch:"))).toEqual([]);
    expect(bank.server.calls.filter((call) => call.startsWith("commit:"))).toHaveLength(1);
  });

  it.each(["policy", "native"] as const)("reports a concurrent %s change as superseded before overwriting it", async (side) => {
    const f = fixture(); f.control.replayNative = true;
    f.control.afterNativeRecovery = async () => {
      f.control.afterNativeRecovery = undefined;
      if (side === "policy") curatorTestRemotePolicy(f.bank, WRITE_TEST_MEMORY, (value) => ({ ...value,
        policy: { ...value.policy, importance: 7, policyVersion: value.policy.policyVersion + 1 } }));
      else {
        const head = f.bank.native.find((entry) => entry.head.object_id === WRITE_TEST_MEMORY)!;
        if (head.body.content.body_schema !== "application-native-record.v1" || !("memory_id" in head.body.content.value.payload)) throw new Error("fixture kind");
        const payload = head.body.content.value.payload;
        publishWriteNativeMemory(f.bank, { ...payload, revision: payload.revision + 1, text: "Newer external edit" });
      }
      await f.refresh();
    };
    const result = await f.writes.mutate(f.call(), mutation(f, true));
    expect(result.outcome).toBe("superseded"); expect(parent(f).applicationKey).toBeNull();
    expect(result.record?.policy.layerId).toBe("unclassified");
    if (side === "policy") expect(result.record?.policy.importance).toBe(7);
    else expect(result.record?.unit.text).toBe("Newer external edit");
  });

  it("does not relabel a newer same-layer policy as its own applied result after the command ACK", async () => {
    const f = fixture(); f.control.pullPolicy = false; const request = mutation(f);
    expect((await f.writes.mutate(f.call(), request)).outcome).toBe("pending");
    curatorTestRemotePolicy(f.bank, WRITE_TEST_MEMORY, (value) => ({ ...value,
      policy: { ...value.policy, visibility: "hidden", importance: 7, policyVersion: value.policy.policyVersion + 1 } }));
    f.control.pullPolicy = true;
    const result = await f.writes.mutate(f.call(), request);
    expect(result.record?.policy).toMatchObject({ layerId: "profile", visibility: "hidden", importance: 7 });
    expect(result.outcome).toBe("superseded");
  });

  it("accepts its exact applied policy when only independent assessment metadata advanced", async () => {
    const f = fixture(); f.control.pullPolicy = false; const request = mutation(f);
    expect((await f.writes.mutate(f.call(), request)).outcome).toBe("pending");
    curatorTestRemotePolicy(f.bank, WRITE_TEST_MEMORY, (value) => ({ ...value,
      assessment: { ...value.assessment, state: "due" } }));
    f.control.pullPolicy = true;
    const result = await f.writes.mutate(f.call(), request);
    expect(result).toMatchObject({ outcome: "applied", record: { policy: { layerId: "profile", policyVersion: 2 } } });
  });

  it("returns superseded with no fabricated record when a committed policy target was subsequently deleted", async () => {
    const f = fixture(); f.control.pullPolicy = false; const request = mutation(f);
    expect((await f.writes.mutate(f.call(), request)).outcome).toBe("pending");
    publishWriteNativeDeletion(f.bank, WRITE_TEST_MEMORY);
    f.control.pullPolicy = true;
    expect(await f.writes.mutate(f.call(), request)).toEqual({ outcome: "superseded", record: null });
    expect(parent(f).terminal).toMatchObject({ kind: "mutation", result: { outcome: "superseded", record: null } });
  });

  it("returns every verified G1 reference and the observed Source revision, never a predicted revision one", async () => {
    const f = fixture(); f.control.replayNative = true; f.native.control.retainCount = 300; f.native.control.sourceRevision = 7;
    const request = writeTestRetain(f.route.bankId, writeTestMetadata(100));
    f.native.control.beforeWrite = (row) => {
      const source = readWriteSourceCommand(f);
      expect(source.job.state).toBe("completed"); expect(source.row.remoteOperationId).toBe(row.remoteOperationId);
      expect(f.bank.artifacts.some((entry) => entry.artifact.binding.kind === "awaiting_native"
        && entry.artifact.binding.operation_id === row.remoteOperationId)).toBe(true);
    };
    const result = await f.writes.retain(f.call(), request);
    expect(result.status).toBe("completed"); expect(result.sourceRevision).toBe(7); expect(result.memories).toHaveLength(300);
    expect(result.memories[299]?.revision).toBe(300);
    expect(child(f).phase).toBe("completed"); expect(child(f).nativeReceipt).toBeNull();
    expect(child(f).nativeResultReceipt?.result.manifest.total_records).toBe(300);
    expect(parent(f).references?.memories).toEqual(result.memories);
    const source = f.base.replica.logicalRecord({ ...f.bank.scope, objectKind: "document", objectId: request.documentId! });
    expect(source?.payload?.kind === "document" && source.payload.value.revision).toBe(7);
    expect(source?.payload?.kind === "document" && hindsightApplicationWireJson(source.payload.value.metadata)).toBe(hindsightApplicationWireJson(request.metadata));
    expect(f.native.calls.filter((call) => call.startsWith("page:")).map((call) => Number(call.split(":").at(-1)))).toEqual([0, 1, 2, 0, 1, 2]);
    f.native.control.sourceRevision = 99;
    expect(await f.writes.retain(f.call(), request)).toEqual(result);
    expect(f.native.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
  }, 30_000);

  it("settles a cancelled owned continuation before stop returns, with no late journal reads or writes", async () => {
    const f = fixture(); const entered = deferred(); const blocked = deferred();
    f.control.beforeRecovery = async () => { entered.resolve(); await blocked.promise; };
    const operation = f.writes.mutate(f.call(), mutation(f));
    // Attach the rejection expectation before abort so the test never leaks an unhandled rejection.
    const rejected = expect(operation).rejects.toThrow("HINDSIGHT_CANCELLED");
    await entered.promise;
    const get = vi.spyOn(f.journal, "get"); const pending = vi.spyOn(f.journal, "pending");
    let stopped = false; const stop = f.writes.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    blocked.resolve(); await rejected; await stop;
    expect(get).not.toHaveBeenCalled(); expect(pending).not.toHaveBeenCalled();
    expect(count(f, "hindsight_memory_write_intents")).toBe(1);
    expect(f.base.db.prepare("SELECT state FROM hindsight_memory_write_intents").get()?.state).toBe("pending");
    expect(() => f.writes.mutationOverlays(f.route.bankId)).toThrow("MEMORY_OPERATION_CANCELLED");
    expect(f.native.calls).toEqual([]);
  });

  it("refuses wrong authority, character provenance and lossy original metadata before committing intents", async () => {
    const f = fixture();
    await expect(f.writes.mutate({ ...writeTestCall(), authorityEpochId: "wrong-epoch" }, mutation(f))).rejects.toThrow("MEMORY_AUTHORITY_MISMATCH");
    await expect(f.writes.retain(f.call(), writeTestRetain(f.route.bankId, writeTestMetadata(0, true)))).rejects.toThrow("MEMORY_INVALID_REQUEST");
    expect(count(f, "hindsight_memory_write_intents")).toBe(0); expect(count(f, "pending_memory")).toBe(0);
    const character = fixture({ bank: writeTestBank({ bankId: "character-bank", characterId: "taki" }) });
    await expect(character.writes.retain(character.call(), writeTestRetain(character.route.bankId))).rejects.toThrow("MEMORY_INVALID_REQUEST");
    expect(count(character, "pending_memory")).toBe(0); expect(count(character, "hindsight_application_command_jobs")).toBe(0);
  });
});
