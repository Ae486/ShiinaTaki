import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { type JsonValue, type MemoryBankScope, type TakiApplicationMemoryBody,
  type TakiApplicationNativePayload, type TakiApplicationSourceBody, type TakiMemoryPolicyProjection } from "@taki/shared";
import { createIntlSegmenterTokenizer } from "../memory/search-tokenizer.ts";
import { rebindHindsightApplicationPolicyEvidence } from "../memory/hindsight/hindsight-policy-assessment.ts";
import { projectHindsightApplicationNativeUnit, readHindsightApplicationNative } from "../memory/hindsight/hindsight-application-projection.ts";
import { applicationTestArtifact, applicationTestBankPayload, applicationTestBody, applicationTestEvent,
  applicationTestMemoryBody, applicationTestMemoryPayload, applicationTestNative, applicationTestNativeBaseline,
  applicationTestSnapshot, applicationTestSourcePayload, APPLICATION_TEST_AT, APPLICATION_TEST_SCOPE,
  type ApplicationArtifactFixture, type ApplicationNativeFixture } from "../testing/hindsight-application-fixtures.ts";
import type { HindsightApplicationBundle, HindsightApplicationEvent } from "../memory/hindsight/hindsight-application-bundle.ts";
import type { HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createHindsightApplicationReplicaRepo } from "./hindsight-application-replica-repo.ts";
import { createApplicationEvidenceAccess } from "./hindsight-application-replica-evidence.ts";
import { createReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import { createStructuredMemoryBlockRepo } from "./structured-memory-block-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { storeApplicationCommandBody } from "./hindsight-application-command-storage.ts";
import { prepareHindsightApplicationBody } from "../memory/hindsight/hindsight-application-body-transfer.ts";
import { loadHindsightApplicationEvent } from "../memory/hindsight/hindsight-application-bundle-loader.ts";
import { applicationCommandTestClient } from "./hindsight-application-command-fixtures.ts";

const EPOCH = "hindsight-epoch";
const AT = APPLICATION_TEST_AT;
const LATER = "2026-09-11T08:00:30.000Z";
const SCOPE = APPLICATION_TEST_SCOPE;
const GLOBAL: MemoryBankScope = { kind: "global", characterId: null };
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.restoreAllMocks(); });

describe("D77 application replica publication", () => {
  it("downloads a remote ref that differs from a valid prepared body with the same ID", async () => {
    const f = fixture(); const source = sourceFixture(); const remote = source.application.body;
    const local = prepareHindsightApplicationBody({ ...SCOPE, bodyId: remote.ref.body_id, schema: "application-source.v1",
      value: { ...source.original, original_source: { ...source.original.original_source, retainedText: "Different local bytes" } } });
    storeApplicationCommandBody(f.db, { ...SCOPE, body: local });
    const guard = f.input(); expect(f.repo.cachedBody({ ...guard, ref: remote.ref })).toBeUndefined();
    const event = applicationTestEvent({ from: { native_cursor: 0, state_cursor: 0 }, artifacts: [source.application], native: [source.native] });
    const server = applicationCommandTestClient();
    for (const body of event.bodies.values()) server.storeBody(body);
    const client = { ...server.client, applicationChangePage: vi.fn(async () => event.pages[0]!) };
    const loaded = await loadHindsightApplicationEvent({ ...SCOPE, manifest: event.manifest, client,
      context: { timeoutMs: 1000 }, cachedBody: (ref) => f.repo.cachedBody({ ...guard, ref }) });
    const downloaded = loaded.bodies.get(remote.ref.body_id)!;
    expect(downloaded.ref).toEqual(remote.ref); expect(downloaded.content).toEqual(remote.content);
    expect(Buffer.from(downloaded.bytes)).toEqual(Buffer.from(remote.bytes));
    expect(server.calls).toContain(`read-body:${remote.ref.body_id}`);
    expect(server.calls).toContain(`read-part:${remote.ref.body_id}:0`);
    expect(client.applicationChangePage).toHaveBeenCalledOnce();
    expect(f.repo.checkpoint(SCOPE.bankId)).toBeUndefined();
  });

  it.each(["bank", "lineage", "generation"])("does not reuse a prepared body from a different %s", (field) => {
    const f = fixture(); const source = sourceFixture();
    const foreign = { ...SCOPE, namespace: { ...SCOPE.namespace } };
    if (field === "bank") foreign.bankId = "other-bank";
    if (field === "lineage") foreign.namespace.provider_lineage = "55555555-5555-4555-8555-555555555555";
    if (field === "generation") foreign.namespace.bank_generation = "55555555-5555-4555-8555-555555555555";
    const body = prepareHindsightApplicationBody({ ...foreign, bodyId: source.application.body.ref.body_id,
      schema: "application-source.v1", value: source.original });
    storeApplicationCommandBody(f.db, { ...foreign, body });
    expect(f.repo.cachedBody({ ...f.input(), ref: source.application.body.ref })).toBeUndefined();
  });

  it("stores guarded download bytes without exposing a checkpoint or inheriting another generation's cache", () => {
    const f = fixture(); const body = sourceFixture().application.body; const guard = f.input();
    f.repo.cacheBodies({ ...guard, bodies: [body] });
    expect(f.repo.cachedBody({ ...guard, ref: body.ref })).toEqual(body);
    expect(f.repo.checkpoint(SCOPE.bankId)).toBeUndefined();
    expect(() => f.repo.body({ ...SCOPE, bodyId: body.ref.body_id })).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_MISSING");
    expect(f.repo.cachedBody({ ...guard, namespace: { ...SCOPE.namespace,
      bank_generation: "55555555-5555-4555-8555-555555555555" }, ref: body.ref })).toBeUndefined();
    f.repo.leases.release(f.lease);
    expect(() => f.repo.cachedBody({ ...guard, ref: body.ref })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(() => f.repo.cacheBodies({ ...guard, bodies: [body] })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
  });

  it("refuses changed cached descriptors or bytes before they can satisfy a complete read", () => {
    const f = fixture(); const body = sourceFixture().application.body; const guard = f.input();
    f.repo.cacheBodies({ ...guard, bodies: [body] });
    expect(() => f.repo.cachedBody({ ...guard, ref: { ...body.ref, payload_hash: "0".repeat(64) } }))
      .toThrow("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
    f.db.prepare("UPDATE hindsight_application_replica_bodies SET bytes_sha256=:hash WHERE body_id=:id")
      .run({ hash: "0".repeat(64), id: body.ref.body_id });
    expect(() => f.repo.cachedBody({ ...guard, ref: body.ref })).toThrow();
    expect(f.repo.checkpoint(SCOPE.bankId)).toBeUndefined();
  });

  it("seeds verified native and application state together, recalls neutral policy and reopens after snapshot expiry", () => {
    const f = fixture(tempPath()); const memory = memoryFixture(); const bank = bankFixture();
    const snapshot = snapshotFixture(bank, [memory]); const baseline = applicationTestNativeBaseline(snapshot);
    const checkpoint = f.repo.seedVerifiedSnapshot({ ...f.input(), bundle: snapshot, nativeBaseline: baseline });
    expect(checkpoint.checkpoint).toEqual(snapshot.manifest.checkpoint);
    expect(checkpoint.native.snapshotId).toBe(baseline.snapshotId);
    expect(checkpoint.snapshot.id).toBe(snapshot.manifest.snapshot_id);
    expect(checkpoint.native.snapshotId).not.toBe(checkpoint.snapshot.id);
    expect(f.repo.search({ ...SCOPE, query: "verified", limit: 1 })[0]).toMatchObject({
      unit: { memoryId: "memory-a", revision: 1, tags: ["taki-layer:unclassified"] },
      policy: { authorityEpochId: EPOCH, layerId: "unclassified", policyVersion: 1, updatedAt: AT },
      provenance: { actor: "provider", origin: "provider-derived", timelineFromSeq: null, timelineToSeq: null },
    });
    expect(f.repo.duePolicyWork({ ...SCOPE, limit: 10 })).toHaveLength(1);
    expect(f.repo.bankBinding(SCOPE.bankId)).toMatchObject({ bankDeleted: false, bindingState: "bound", bank: { scope: GLOBAL } });
    const record = f.repo.record({ ...SCOPE, memoryId: "memory-a" }); f.close();
    const reopened = fixture(f.path, { now: "2030-01-01T00:00:00.000Z", acquire: false });
    expect(reopened.repo.checkpoint(SCOPE.bankId)).toEqual(checkpoint);
    expect(reopened.repo.record({ ...SCOPE, memoryId: "memory-a" })).toEqual(record);
    expect(reopened.repo.body({ ...SCOPE, bodyId: memory.application.body.ref.body_id })?.content)
      .toEqual(memory.application.body.content);
    expect(reopened.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("still refuses an expired ordinary native baseline before any application snapshot publication", () => {
    const f = fixture(); const snapshot = snapshotFixture(bankFixture(), [memoryFixture()]);
    const baseline = applicationTestNativeBaseline(snapshot);
    baseline.expiresAt = new Date(Date.now() - 1).toISOString();
    expect(() => f.repo.seedVerifiedSnapshot({ ...f.input(), bundle: snapshot, nativeBaseline: baseline })).toThrow();
    expect(f.repo.checkpoint(SCOPE.bankId)).toBeUndefined();
    expect(f.repo.nativeCheckpoint(SCOPE.bankId)).toBeUndefined();
  });

  it("publishes an app-only visibility change without inventing a native revision or cursor", () => {
    const f = fixture(); const memory = memoryFixture(); seed(f, snapshotFixture(bankFixture(), [memory]));
    const before = f.repo.checkpoint(SCOPE.bankId)!;
    const hidden = changePolicy(memory, { visibility: "hidden", policyVersion: 2, updatedAt: LATER });
    const event = applicationTestEvent({ from: before.checkpoint, native: [hidden.native], artifacts: [hidden.application] });
    const next = apply(f, event);
    expect(next.checkpoint.native_cursor).toBe(before.checkpoint.native_cursor);
    expect(next.checkpoint.state_cursor).toBe(before.checkpoint.state_cursor + 1);
    expect(next.native.snapshotId).toBe(before.native.snapshotId);
    expect(next.native.snapshotManifestDigest).toBe(before.native.snapshotManifestDigest);
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a" })).toBeUndefined();
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true }))
      .toMatchObject({ unit: { revision: 1 }, policy: { visibility: "hidden", policyVersion: 2 } });
    expect(f.repo.search({ ...SCOPE, query: "verified", limit: 10 })).toEqual([]);
    expect(f.repo.artifact({ ...SCOPE, version: version(memory.application) })).toEqual(memory.application.artifact);
    expect(f.repo.latestArtifact({ ...SCOPE, key: memory.application.artifact.key })).toEqual(hidden.application.artifact);
    expect(() => apply(f, event, before)).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_STALE");
  });

  it("withdraws an edited native projection until an exact restriction-preserving rebind is persisted", () => {
    const f = fixture(); const old = memoryFixture({ policy: { visibility: "hidden" } });
    seed(f, snapshotFixture(bankFixture(), [old]));
    const current = applicationTestNative({ kind: "memory_unit", cursor: 3,
      payload: applicationTestMemoryPayload({ document_id: null, text: "Externally edited fixture", revision: 2, tags: [] }) });
    current.head.binding_state = "rebind_required"; current.head.bound_artifact = version(old.application);
    current.head.previous_version = old.native.head.version;
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [current] }));
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true })).toBeUndefined();
    expect(f.repo.bindingWork({ ...SCOPE, limit: 10 })).toMatchObject([{ head: { binding_state: "rebind_required" },
      memory: { policy: { visibility: "hidden" } } }]);
    const evidence = createApplicationEvidenceAccess(f.db, SCOPE);
    const native = readHindsightApplicationNative({ ...SCOPE, head: current.head, evidence });
    const body = rebindHindsightApplicationPolicyEvidence({ current: { ...SCOPE, authorityEpochId: EPOCH,
      bank: f.repo.bankBinding(SCOPE.bankId)!.bank!, activeCharacterId: null,
      native: { ...SCOPE, status: "verified", native: native.version,
        unit: projectHindsightApplicationNativeUnit({ ...SCOPE, native, authorityEpochId: EPOCH }) } },
    previous: { ...SCOPE, status: "present", native: old.native.head.version!, artifact: version(old.application), body: old.policy },
    expectedArtifact: version(old.application) });
    expect(body.policy).toEqual(old.policy.policy);
    const rebound = bind(current, applicationTestArtifact({ key: old.application.artifact.key, revision: 2,
      body: applicationTestBody("application-memory.v1", body), binding: { kind: "exact_native", native: native.version } }));
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint,
      native: [rebound.native], artifacts: [rebound.application] }));
    expect(f.repo.bindingWork({ ...SCOPE, limit: 10 })).toEqual([]);
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true }))
      .toMatchObject({ unit: { revision: 2, text: "Externally edited fixture" }, policy: { visibility: "hidden", policyVersion: 1 } });
    expect(f.repo.search({ ...SCOPE, query: "Externally", limit: 10 })).toEqual([]);
  });

  it("rolls back bodies, artifacts, heads, FTS and both checkpoints if final application CAS fails", () => {
    const f = fixture(); const old = memoryFixture(); seed(f, snapshotFixture(bankFixture(), [old]));
    const before = databaseState(f.db);
    const hidden = changePolicy(old, { visibility: "hidden", policyVersion: 2 });
    const event = applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [hidden.native], artifacts: [hidden.application] });
    f.db.exec(`CREATE TRIGGER fail_application_checkpoint BEFORE UPDATE ON hindsight_application_replica_checkpoints
      BEGIN SELECT RAISE(ABORT,'injected application checkpoint failure'); END;`);
    expect(() => apply(f, event)).toThrow("injected application checkpoint failure");
    expect(databaseState(f.db)).toEqual(before);
    expect(f.repo.search({ ...SCOPE, query: "verified", limit: 1 })).toHaveLength(1);
    f.db.exec("DROP TRIGGER fail_application_checkpoint");
    expect(apply(f, event).checkpoint.state_cursor).toBe(1);
  });

  it("requires a real matching V1 baseline for initial application publication", () => {
    const f = fixture(); const snapshot = snapshotFixture(bankFixture(), [memoryFixture()]);
    expect(() => f.repo.seedVerifiedSnapshot({ ...f.input(), bundle: snapshot })).toThrow("HINDSIGHT_APPLICATION_NATIVE_BASELINE_REQUIRED");
    const baseline = applicationTestNativeBaseline(snapshot);
    expect(() => f.repo.seedVerifiedSnapshot({ ...f.input(), bundle: snapshot,
      nativeBaseline: { ...baseline, manifest: { ...baseline.manifest, endCursor: 99 } } })).toThrow();
    expect(f.repo.checkpoint(SCOPE.bankId)).toBeUndefined();
    expect(f.repo.nativeCheckpoint(SCOPE.bankId)).toBeUndefined();
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_bodies").get()?.n).toBe(0);
  });

  it("preserves B5's same-native-revision hash guard on the old record path", () => {
    const f = fixture(); const store = createReplicaRecordStore(f.db, createIntlSegmenterTokenizer({ stoplist: true }));
    seed(f, snapshotFixture(bankFixture(), [memoryFixture()]));
    const record = f.repo.logicalRecord({ ...SCOPE, objectKind: "memory_unit", objectId: "memory-a" })!;
    store.write(record, 2);
    if (record.payload?.kind !== "memory_unit") throw new Error("fixture missing memory");
    const value = record.payload.value;
    expect(() => store.write({ ...record, payload: { kind: "memory_unit", value: { ...value,
      policy: { ...value.policy, visibility: "hidden" } } } }, 2)).toThrow("HINDSIGHT_REPLICA_REVISION_STALE");
  });

  it("applies hidden, retention, mood, layer and fact-type eligibility before the final search limit", () => {
    const f = fixture();
    const memories = [
      memoryFixture({ payload: { memory_id: "a-hidden", text: "shared signal" }, policy: { visibility: "hidden" } }),
      memoryFixture({ payload: { memory_id: "b-expired", text: "shared signal" }, policy: { retention: { kind: "expiring", expiresAt: AT } } }),
      memoryFixture({ payload: { memory_id: "c-mood", text: "shared signal" }, policy: { visibility: "mood-gated", disclosure: "movie" } }),
      memoryFixture({ payload: { memory_id: "d-profile", text: "shared signal" }, policy: { layerId: "profile" } }),
      memoryFixture({ payload: { memory_id: "z-visible", text: "shared signal", fact_type: "experience" } }),
    ];
    seed(f, snapshotFixture(bankFixture(), memories));
    // A stale high-rank FTS row does not authorize its hidden Canonical record or consume the caller's limit.
    f.db.prepare(`INSERT INTO hindsight_replica_sync_fts(bank_id,object_id,text,context,disclosure,search_terms)
      VALUES (:bank,'a-hidden','shared signal',NULL,NULL,'shared signal')`).run({ bank: SCOPE.bankId });
    expect(f.repo.search({ ...SCOPE, query: "signal", limit: 1, layerIds: ["unclassified"], factTypes: ["experience"] })
      .map((value) => value.unit.memoryId)).toEqual(["z-visible"]);
    expect(f.repo.search({ ...SCOPE, query: "signal movie", limit: 1, layerIds: ["unclassified"], factTypes: ["world"] })
      .map((value) => value.unit.memoryId)).toEqual(["c-mood"]);
    expect(f.repo.search({ ...SCOPE, query: "signal", limit: 10, layerIds: [], factTypes: [] })
      .map((value) => value.unit.memoryId)).toEqual(["d-profile", "z-visible"]);
  });

  it("restores failed assessment retry state without making neutral recall wait for a model", () => {
    const f = fixture(tempPath()); const memory = memoryFixture(); seed(f, snapshotFixture(bankFixture(), [memory]));
    const failed = changePolicy(memory, {}, { assessment: { ...memory.policy.assessment,
      state: "failed", attempts: 1, last_failure_code: "model_unavailable", next_attempt_at: LATER } });
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [failed.native], artifacts: [failed.application] }));
    expect(f.repo.search({ ...SCOPE, query: "verified", limit: 1 })).toHaveLength(1);
    expect(f.repo.duePolicyWork({ ...SCOPE, limit: 10, at: AT })).toEqual([]);
    f.close(); const reopened = fixture(f.path, { acquire: false });
    expect(reopened.repo.duePolicyWork({ ...SCOPE, limit: 10, at: LATER }))
      .toMatchObject([{ memory: { assessment: { state: "failed", attempts: 1, last_failure_code: "model_unavailable" } } }]);
    expect(reopened.repo.record({ ...SCOPE, memoryId: "memory-a" })?.policy).toEqual(memory.policy.policy);
  });

  it("isolates equal object IDs across Banks and refuses another generation's evidence", () => {
    const f = fixture(); seed(f, snapshotFixture(bankFixture(), [memoryFixture({ payload: { text: "first bank signal" } })]));
    const other = { bankId: "bank-b", namespace: { ...SCOPE.namespace, bank_generation: "33333333-3333-4333-8333-333333333333" } };
    const second = fixture(":memory:", { db: f.db, scope: other });
    seed(second, snapshotFixture(bankFixture(other), [memoryFixture({ scope: other, payload: { text: "second bank signal" } })]));
    expect(f.repo.search({ ...SCOPE, query: "signal", limit: 10 }).map((value) => value.unit.text)).toEqual(["first bank signal"]);
    expect(second.repo.search({ ...other, query: "signal", limit: 10 }).map((value) => value.unit.text)).toEqual(["second bank signal"]);
    expect(() => second.repo.record({ ...other, namespace: SCOPE.namespace, memoryId: "memory-a" })).toThrow("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
    expect(() => f.repo.body({ ...SCOPE, namespace: other.namespace, bodyId: "missing" })).toThrow("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
  });

  it.each(["scope", "lease", "deadline"] as const)("rolls back when the final %s guard changes during projection", (failure) => {
    let interfere = false;
    const f = fixture(":memory:", { onTokenize: () => {
      if (!interfere) return;
      if (failure === "scope") f.ownership({ kind: "character", characterId: "other" });
      else if (failure === "lease") f.now("2026-09-11T08:01:00.001Z");
      else f.now("2026-09-11T08:00:50.000Z");
    } });
    const memory = memoryFixture(); seed(f, snapshotFixture(bankFixture(), [memory])); const before = databaseState(f.db);
    const changed = changePolicy(memory, { importance: 6, policyVersion: 2 });
    const event = applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [changed.native], artifacts: [changed.application] });
    const input = { ...f.input(), expectedCheckpoint: f.repo.checkpoint(SCOPE.bankId)!, event,
      ...(failure === "deadline" ? { deadlineAt: "2026-09-11T08:00:49.000Z" } : {}) };
    interfere = true;
    expect(() => f.repo.applyEvent(input)).toThrow(failure === "scope" ? "HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH"
      : failure === "lease" ? "HINDSIGHT_REPLICA_LEASE_LOST" : "HINDSIGHT_DEADLINE_EXCEEDED");
    expect(databaseState(f.db)).toEqual(before);
    interfere = false; f.ownership(GLOBAL); f.now(AT);
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a" })?.policy.importance).toBe(5);
  });

  it("keeps special own keys, typed numeric values and JSON deeper than SQLite JSON1 in BLOB projections", () => {
    let deep: JsonValue = "leaf";
    for (let level = 0; level < 1100; level++) deep = { child: deep };
    const metadata: Record<string, JsonValue> = Object.fromEntries([["__proto__", { data: true }], ["constructor", "own data"], ["zero", -0],
      ["null", null], ["empty", []], ["json-looking", '{"typed":false}'], ["nul\0key", "nul\0value"], ["lone-value", '"\\udfff"'], ["deep", deep]]);
    const f = fixture(tempPath()); let memory = memoryFixture({ payload: { metadata } });
    const native = memory.native.body.content;
    if (native.body_schema !== "application-native-record.v1") throw new Error("fixture native body missing");
    const unit = projectHindsightApplicationNativeUnit({ ...SCOPE, native: native.value, authorityEpochId: EPOCH });
    const originalMetadata = Object.fromEntries([...Object.entries(metadata), ["lone-value", "\udfff"], ["original\ud800key", "\udfff"]]);
    const policy = { ...memory.policy, encoded_metadata: metadata, original_record: { unit: { ...unit,
      tags: ["taki-layer:unclassified"], metadata: originalMetadata }, policy: memory.policy.policy, provenance: memory.policy.provenance } };
    memory = { ...bind(memory.native, applicationTestArtifact({ key: memory.application.artifact.key,
      body: applicationTestBody("application-memory.v1", policy), binding: { kind: "exact_native", native: memory.native.head.version! } })), policy };
    seed(f, snapshotFixture(bankFixture(), [memory])); f.close(); const reopened = fixture(f.path, { acquire: false });
    const result = reopened.repo.record({ ...SCOPE, memoryId: "memory-a" })!.unit.metadata;
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toEqual({ data: true });
    expect(result["constructor"]).toBe("own data");
    // The shared/native tagged-binary64 contract normalizes both zero signs; it still preserves number versus string.
    expect(Object.is(result["zero"], 0)).toBe(true);
    expect(result["json-looking"]).toBe('{"typed":false}');
    expect(result["nul\0key"]).toBe("nul\0value"); expect(result["lone-value"]).toBe("\udfff");
    expect(Object.hasOwn(result, "original\ud800key")).toBe(false);
    const restored = reopened.repo.body({ ...SCOPE, bodyId: memory.application.body.ref.body_id })!.content;
    if (restored.body_schema !== "application-memory.v1") throw new Error("fixture application body missing");
    expect(restored.value.original_record!.unit.metadata["original\ud800key"]).toBe("\udfff");
    let node = result["deep"];
    for (let level = 0; level < 1100; level++) node = (node as Record<string, JsonValue>)["child"];
    expect(node).toBe("leaf");
    expect(reopened.db.prepare("SELECT typeof(record_bytes) AS storage FROM hindsight_application_replica_projections WHERE object_kind='memory_unit'")
      .get()?.storage).toBe("blob");
  });

  it("restores user-owned Blocks with exact revision and refuses to overwrite a later local user edit", () => {
    const f = fixture(); const bank = bankFixture(); const block = blockFixture({ content: "The owner's complete card", blockRevision: 7 });
    seed(f, applicationTestSnapshot({ native: [bank.native], artifacts: [bank.application, block] }));
    const blocks = createStructuredMemoryBlockRepo(f.db);
    expect(blocks.read("user-card", GLOBAL)).toMatchObject({ content: "The owner's complete card", revision: 7, updatedAt: AT });
    const changed = blockFixture({ content: "Native-preserved newer card", blockRevision: 8, artifactRevision: 2 });
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, artifacts: [changed] }));
    expect(blocks.read("user-card", GLOBAL)?.revision).toBe(8);
    blocks.replace({ blockId: "user-card", scope: GLOBAL, content: "New local owner text", expectedRevision: 8, actor: "user", now: LATER });
    const before = databaseState(f.db); const conflicting = blockFixture({ content: "Remote conflicting card", blockRevision: 9, artifactRevision: 3 });
    expect(() => apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, artifacts: [conflicting] })))
      .toThrow("HINDSIGHT_APPLICATION_BLOCK_RESTORE_CONFLICT");
    expect(databaseState(f.db)).toEqual(before);
    expect(blocks.read("user-card", GLOBAL)?.content).toBe("New local owner text");
  });

  it("returns every eligible pinned/promoted record or an explicit overflow, preserving restrictions", () => {
    const f = fixture(); const memories = [
      memoryFixture({ payload: { memory_id: "pin", text: "Pinned promise" }, policy: { visibility: "pinned" } }),
      memoryFixture({ payload: { memory_id: "promoted", text: "Deliberately important fact" }, policy: { layerId: "profile", importance: 9 } }),
      memoryFixture({ payload: { memory_id: "hidden", text: "Hidden important fact" }, policy: { layerId: "profile", importance: 10, visibility: "hidden" } }),
      memoryFixture({ payload: { memory_id: "expired", text: "Expired pin" }, policy: { visibility: "pinned", retention: { kind: "expiring", expiresAt: AT } } }),
      memoryFixture({ payload: { memory_id: "ordinary", text: "Ordinary fact" } }),
    ];
    seed(f, snapshotFixture(bankFixture(), memories));
    expect(f.repo.pinned({ ...SCOPE, limit: 2 }).map((record) => record.unit.memoryId)).toEqual(["promoted", "pin"]);
    expect(() => f.repo.pinned({ ...SCOPE, limit: 1 })).toThrow("HINDSIGHT_APPLICATION_PINNED_OVERFLOW");
  });

  it("keyset-scans past ineligible due work before applying the maintenance limit", () => {
    const f = fixture(); const hidden = Array.from({ length: 35 }, (_, index) => memoryFixture({
      payload: { memory_id: `a-hidden-${String(index).padStart(2, "0")}` }, policy: { visibility: "hidden" },
    }));
    const invalidated = memoryFixture({ payload: { memory_id: "b-invalidated", state: "invalidated", invalidated_at: AT, invalidation_reason: "old" } });
    const expired = memoryFixture({ payload: { memory_id: "c-expired" }, policy: { retention: { kind: "expiring", expiresAt: AT } } });
    const mood = memoryFixture({ payload: { memory_id: "d-mood" }, policy: { visibility: "mood-gated", disclosure: "movie" } });
    const eligible = memoryFixture({ payload: { memory_id: "z-eligible" } });
    seed(f, snapshotFixture(bankFixture(), [...hidden, invalidated, expired, mood, eligible]));
    expect(f.repo.duePolicyWork({ ...SCOPE, limit: 1, eligibleForMaintenance: true }).map((work) => work.head.object_id)).toEqual(["z-eligible"]);
    expect(f.repo.duePolicyWork({ ...SCOPE, limit: 1 }).map((work) => work.head.object_id)).toEqual(["a-hidden-00"]);
    expect(f.repo.duePolicyWork({ ...SCOPE, limit: 100 })).toHaveLength(39);
  });

  it("continues binding work after a captured cursor even when an earlier row is rebound at a newer checkpoint", () => {
    const f = fixture(); const bank = bankFixture(); const records = [
      memoryFixture({ payload: { memory_id: "a-invalid", state: "invalidated", invalidated_at: AT, invalidation_reason: "old" } }),
      memoryFixture({ payload: { memory_id: "b-valid" } }), memoryFixture({ payload: { memory_id: "c-valid" } }),
    ];
    const unbound = records.map((value) => ({ ...value.native,
      head: { ...value.native.head, binding_state: "binding_missing" as const, bound_artifact: null } }));
    seed(f, applicationTestSnapshot({ native: [bank.native, ...unbound], artifacts: [bank.application] }));
    const first = f.repo.bindingWork({ ...SCOPE, limit: 1 })[0]!;
    expect(first.head.object_id).toBe("a-invalid");
    const second = f.repo.bindingWork({ ...SCOPE, limit: 1, after: first.cursor })[0]!;
    expect(second.head.object_id).toBe("b-valid");
    const candidate = records[1]!;
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [candidate.native], artifacts: [candidate.application] }));
    expect(f.repo.bindingWork({ ...SCOPE, limit: 1, after: second.cursor }).map((work) => work.head.object_id)).toEqual(["c-valid"]);
    expect(f.repo.record({ ...SCOPE, memoryId: "a-invalid", includeInvalidated: true })).toBeUndefined();
    expect(() => f.repo.bindingWork({ ...SCOPE, limit: 1, after: { ...first.cursor, bankId: "other" } }))
      .toThrow("HINDSIGHT_APPLICATION_WORK_CURSOR_INVALID");
  });

  it("retains all latest Source intent candidates without implying their successful native association", () => {
    const f = fixture(); const bank = bankFixture(); const exact = sourceFixture();
    const awaiting = sourceFixture({ artifactId: "awaiting-a", awaiting: true });
    const other = sourceFixture({ artifactId: "awaiting-b", documentId: "document-b", awaiting: true });
    const retired = sourceFixture({ artifactId: "retired", awaiting: true, tombstoned: true });
    const block = blockFixture({ content: "Preserved user identity", blockRevision: 4 });
    const customBlock = applicationTestArtifact({ key: { artifact_kind: "block", artifact_id: "historic-custom-card-key" },
      body: block.body, binding: { kind: "core_block" } });
    seed(f, applicationTestSnapshot({ native: [bank.native, exact.native],
      artifacts: [bank.application, exact.application, awaiting.application, other.application, retired.application, customBlock] }));
    const candidates = f.repo.sourceArtifacts(SCOPE);
    expect(candidates.map((value) => value.key.artifact_id)).toEqual(["awaiting-a", "awaiting-b", "source-a"]);
    expect(f.repo.sourceArtifacts({ ...SCOPE, documentId: "document-a" }).map((value) => value.key.artifact_id)).toEqual(["awaiting-a", "source-a"]);
    expect(candidates.find((value) => value.key.artifact_id === "awaiting-a")?.binding.kind).toBe("awaiting_native");
    expect(f.repo.blockArtifacts(SCOPE)[0]?.key.artifact_id).toBe("historic-custom-card-key");
    expect(createStructuredMemoryBlockRepo(f.db).read("user-card", GLOBAL)?.revision).toBe(4);
  });

  it("validates only the body closure of Source candidates selected by document identity", () => {
    const f = fixture(); const bank = bankFixture(); const exact = sourceFixture();
    const other = sourceFixture({ artifactId: "other-source", documentId: "document-b", awaiting: true });
    seed(f, applicationTestSnapshot({ native: [bank.native, exact.native], artifacts: [bank.application, exact.application, other.application] }));
    const reads: string[] = []; const prepare = f.db.prepare.bind(f.db);
    vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (!sql.includes("FROM hindsight_application_replica_bodies")) return statement;
      return { ...statement, get: (params) => { reads.push(String(params?.id)); return statement.get(params); } };
    });
    expect(f.repo.sourceArtifacts({ ...SCOPE, documentId: "document-a" }).map((value) => value.key.artifact_id)).toEqual(["source-a"]);
    expect(new Set(reads)).toEqual(new Set([exact.application.body.ref.body_id]));
  });

  it("selects awaiting Source bindings before reading unrelated exact-source bodies", () => {
    const f = fixture(); const bank = bankFixture(); const exact = sourceFixture();
    const awaiting = sourceFixture({ artifactId: "awaiting-source", documentId: "document-b", awaiting: true });
    seed(f, applicationTestSnapshot({ native: [bank.native, exact.native], artifacts: [bank.application, exact.application, awaiting.application] }));
    expect(f.repo.sourceArtifacts({ ...SCOPE, bindingKind: "awaiting_native" }).map((value) => value.key.artifact_id))
      .toEqual(["awaiting-source"]);
  });

  it("filters binding work by native kind before loading unrelated candidate bodies", () => {
    const f = fixture(); const bank = bankFixture();
    const memory = applicationTestNative({ kind: "memory_unit", cursor: 2, payload: applicationTestMemoryPayload({ document_id: null }) });
    seed(f, applicationTestSnapshot({ native: [bank.native, memory], artifacts: [bank.application] }));
    expect(f.repo.bindingWork({ ...SCOPE, limit: 1, objectKind: "document" })).toEqual([]);
    expect(f.repo.bindingWork({ ...SCOPE, limit: 1, objectKind: "memory_unit" }).map((entry) => entry.head.object_id)).toEqual(["memory-a"]);
  });

  it("supports same-native source-dependency rebinding and remote-only original-source reconstruction", () => {
    const f = fixture(); const bank = bankFixture(); const source = sourceFixture();
    let memory = memoryFixture({ payload: { document_id: "document-a", metadata: { shared: "7", unitOnly: "[]" } },
      policy: { visibility: "hidden" } });
    const native = memory.native.body.content;
    if (native.body_schema !== "application-native-record.v1") throw new Error("fixture native body missing");
    const unit = projectHindsightApplicationNativeUnit({ ...SCOPE, authorityEpochId: EPOCH, native: native.value });
    const provenance = { ...memory.policy.provenance, actor: "agent" as const, origin: "explicit-agent" as const,
      timelineFromSeq: 10, timelineToSeq: 11, sourceRef: "original-unit-evidence" };
    const policy = { ...memory.policy, source_artifacts: [version(source.application)], provenance,
      encoded_metadata: { shared: "7", unitOnly: "[]" }, original_record: {
        unit: { ...unit, authorityEpochId: "original-epoch", bankId: "original-bank", memoryId: "original-unit",
          tags: ["taki-layer:unclassified"], metadata: { shared: 7, unitOnly: [] } },
        policy: { ...memory.policy.policy, authorityEpochId: "original-epoch", bankId: "original-bank", memoryId: "original-unit" }, provenance,
      } };
    memory = { ...bind(memory.native, applicationTestArtifact({ key: memory.application.artifact.key,
      body: applicationTestBody("application-memory.v1", policy), binding: { kind: "exact_native", native: memory.native.head.version! } })), policy };
    seed(f, applicationTestSnapshot({ native: [bank.native, source.native, memory.native],
      artifacts: [bank.application, source.application, memory.application] }));
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true })?.unit.metadata).toEqual({ shared: 7, unitOnly: [] });
    const originalSource = f.repo.logicalRecord({ ...SCOPE, objectKind: "document", objectId: "document-a" })!;
    expect(originalSource.payload).toMatchObject({ kind: "document", value: { metadata: { shared: { source: true }, sourceOnly: [1, null] },
      provenance: { actor: "user", origin: "explicit-user", timelineFromSeq: 1, timelineToSeq: 2 } } });

    const edited = applicationTestNative({ kind: "document", cursor: 3, revision: 2,
      payload: { ...applicationTestSourcePayload(), metadata: { shared: "2", added: '{"native":true}' }, updated_at: LATER },
      source: { text: "Edited native source body", context: "Current native context", metadata: { shared: "2", added: '{"native":true}' } } });
    const editedSource = bind(edited, applicationTestArtifact({ key: source.application.artifact.key, revision: 2,
      body: applicationTestBody("application-source.v1", source.original), binding: { kind: "exact_native", native: edited.head.version! } }));
    const dependent = { ...memory.native, head: { ...memory.native.head, binding_state: "rebind_required" as const,
      previous_version: memory.native.head.version, cause: "native_change" as const } };
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint,
      native: [editedSource.native, dependent], artifacts: [editedSource.application] }));
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true })).toBeUndefined();
    expect(f.repo.bindingWork({ ...SCOPE, limit: 10 })[0]?.head).toMatchObject({ object_id: "memory-a", binding_state: "rebind_required",
      version: memory.native.head.version, previous_version: memory.native.head.version });
    const reboundBody = { ...memory.policy, source_artifacts: [version(editedSource.application)],
      assessment: { ...memory.policy.assessment, state: "due" as const } };
    const rebound = bind(dependent, applicationTestArtifact({ key: memory.application.artifact.key, revision: 2,
      body: applicationTestBody("application-memory.v1", reboundBody), binding: { kind: "exact_native", native: memory.native.head.version! } }));
    const before = f.repo.checkpoint(SCOPE.bankId)!;
    const next = apply(f, applicationTestEvent({ from: before.checkpoint, native: [rebound.native], artifacts: [rebound.application] }));
    expect(next.checkpoint.native_cursor).toBe(before.checkpoint.native_cursor);
    expect(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true }))
      .toMatchObject({ unit: { revision: 1 }, policy: { visibility: "hidden", policyVersion: 1 }, provenance: { actor: "agent" } });
    const currentSource = f.repo.logicalRecord({ ...SCOPE, objectKind: "document", objectId: "document-a" });
    expect(currentSource?.payload).toMatchObject({ kind: "document", value: { retainedText: "Edited native source body",
      metadata: { shared: "2", added: '{"native":true}' }, provenance: { actor: "provider", origin: "provider-derived", timelineFromSeq: null, timelineToSeq: null } } });

    // A new local database receives only the complete remote snapshot. No former native unit body or local source table is supplied.
    const remote = applicationTestSnapshot({ checkpoint: next.checkpoint, native: [bank.native, editedSource.native, rebound.native],
      artifacts: [bank.application, source.application, editedSource.application, memory.application, rebound.application] });
    const rebuilt = fixture(); seed(rebuilt, remote);
    expect(rebuilt.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true }))
      .toEqual(f.repo.record({ ...SCOPE, memoryId: "memory-a", includeHidden: true }));
    expect(rebuilt.repo.logicalRecord({ ...SCOPE, objectKind: "document", objectId: "document-a" })).toEqual(currentSource);
    const original = rebuilt.repo.body({ ...SCOPE, bodyId: source.application.body.ref.body_id })!.content;
    expect(original).toEqual(source.application.body.content);
    expect(rebuilt.repo.artifact({ ...SCOPE, version: version(source.application) })).toEqual(source.application.artifact);
    expect(rebuilt.repo.search({ ...SCOPE, query: "verified", limit: 10 })).toEqual([]);
  });

  it("never replaces unavailable current source text with a preserved old source or its operation ID", () => {
    const f = fixture(); const bank = bankFixture(); const source = sourceFixture();
    const native = applicationTestNative({ kind: "document", revision: 2, cursor: 3,
      payload: { ...applicationTestSourcePayload(), updated_at: LATER } });
    const original = { ...source.original, operation_id: randomUUID() };
    const application = applicationTestArtifact({ key: source.application.artifact.key, revision: 2,
      body: applicationTestBody("application-source.v1", original), binding: { kind: "exact_native", native: native.head.version! } });
    const current = bind(native, application);
    seed(f, applicationTestSnapshot({ native: [bank.native, current.native], artifacts: [bank.application, source.application, application] }));
    expect(f.repo.logicalRecord({ ...SCOPE, objectKind: "document", objectId: "document-a" })?.payload)
      .toMatchObject({ kind: "document", value: { retainedText: null, context: null,
        provenance: { actor: "provider", origin: "provider-derived", timelineFromSeq: null, timelineToSeq: null } } });
    expect(f.repo.body({ ...SCOPE, bodyId: source.application.body.ref.body_id })?.content).toEqual(source.application.body.content);
  });

  it("rejects a changed native payload at the same native revision and a rewritten historical artifact", () => {
    const f = fixture(); const memory = memoryFixture(); seed(f, snapshotFixture(bankFixture(), [memory]));
    const before = databaseState(f.db);
    const native = applicationTestNative({ kind: "memory_unit", cursor: 3,
      payload: applicationTestMemoryPayload({ document_id: null, text: "Changed text at a forged old revision" }) });
    const current = bind(native, applicationTestArtifact({ key: memory.application.artifact.key, revision: 2,
      body: applicationTestBody("application-memory.v1", applicationTestMemoryBody(native.head.version!)),
      binding: { kind: "exact_native", native: native.head.version! } }));
    expect(() => apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint,
      native: [current.native], artifacts: [current.application] }))).toThrow("HINDSIGHT_APPLICATION_BINDING_INVALID");
    const alternate = applicationTestArtifact({ key: memory.application.artifact.key, revision: 1,
      body: applicationTestBody("application-memory.v1", { ...memory.policy, policy: { ...memory.policy.policy, visibility: "hidden" } }),
      binding: { kind: "exact_native", native: memory.native.head.version! } });
    expect(() => apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, artifacts: [alternate] })))
      .toThrow("HINDSIGHT_APPLICATION_EVIDENCE_CONFLICT");
    expect(databaseState(f.db)).toEqual(before);
  });

  it("repairs derived projections from a fresh same-generation snapshot while retaining the real V1 baseline identity", () => {
    const f = fixture(); const bank = bankFixture(); const memory = memoryFixture(); seed(f, snapshotFixture(bank, [memory]));
    const before = f.repo.checkpoint(SCOPE.bankId)!;
    f.db.exec("DELETE FROM hindsight_replica_sync_fts");
    f.db.exec("UPDATE hindsight_application_replica_projections SET bytes_sha256=printf('%064d',0) WHERE object_kind='memory_unit'");
    const snapshot = snapshotFixture(bank, [memory]);
    const result = f.repo.reconcileVerifiedSnapshot({ ...f.input(), bundle: snapshot });
    expect(result.native.snapshotId).toBe(before.native.snapshotId);
    expect(result.native.snapshotManifestDigest).toBe(before.native.snapshotManifestDigest);
    expect(result.snapshot.id).toBe(snapshot.manifest.snapshot_id);
    expect(f.repo.search({ ...SCOPE, query: "verified", limit: 1 })).toHaveLength(1);
  });

  it("withdraws old B5 rows on first application publication without altering another Bank", () => {
    const f = fixture(); const store = createReplicaRecordStore(f.db, createIntlSegmenterTokenizer({ stoplist: true }));
    const old = { authorityEpochId: EPOCH, bankId: SCOPE.bankId, scope: GLOBAL, name: "Old B5 bank", disposition: { skepticism: 3, literalism: 3, empathy: 3 },
      mission: "", config: {}, revision: 1, createdAt: AT, updatedAt: AT };
    store.write({ bankId: SCOPE.bankId, objectKind: "bank", objectId: SCOPE.bankId, objectRevision: 1, operation: "upsert", payload: { kind: "bank", value: old } }, null);
    store.write({ bankId: "other", objectKind: "bank", objectId: "other", objectRevision: 1, operation: "upsert",
      payload: { kind: "bank", value: { ...old, bankId: "other" } } }, null);
    seed(f, snapshotFixture(bankFixture(), [memoryFixture()]));
    expect(store.get({ bankId: SCOPE.bankId, objectKind: "bank", objectId: SCOPE.bankId })).toBeUndefined();
    expect(store.get({ bankId: "other", objectKind: "bank", objectId: "other" })).toBeDefined();
    expect(f.repo.bankBinding(SCOPE.bankId)?.bank?.name).toBe("Fixture Bank");
  });

  it("closes a deleted Bank without deleting source evidence, and separates a recreated generation", () => {
    const f = fixture(); const bank = bankFixture(); const source = sourceFixture(); const memory = memoryFixture();
    seed(f, applicationTestSnapshot({ native: [bank.native, source.native, memory.native], artifacts: [bank.application, source.application, memory.application] }));
    const closed = { ...bank.native, bodies: [], head: { ...bank.native.head, version: null, body_ref: null,
      binding_state: "tombstoned" as const, cause: "native_delete" as const,
      tombstone: { object_kind: "bank" as const, object_id: SCOPE.bankId, object_revision: 2,
        last_payload_hash: bank.native.head.version!.payload_hash, native_cursor: 3 } } };
    apply(f, applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [closed], bankDeleted: true }));
    expect(f.repo.bankBinding(SCOPE.bankId)).toMatchObject({ bankDeleted: true, bindingState: "tombstoned", bank: undefined });
    expect(() => f.repo.record({ ...SCOPE, memoryId: "memory-a" })).toThrow("HINDSIGHT_APPLICATION_BANK_DELETED");
    expect(f.repo.body({ ...SCOPE, bodyId: source.application.body.ref.body_id })?.content).toEqual(source.application.body.content);
    const nextScope = { ...SCOPE, namespace: { ...SCOPE.namespace, bank_generation: "33333333-3333-4333-8333-333333333333" } };
    const snapshot = snapshotFixture(bankFixture(nextScope), [memoryFixture({ scope: nextScope, payload: { text: "Recreated generation fact" } })]);
    const reset = { ...f.input(), ...nextScope, bundle: snapshot, nativeBaseline: applicationTestNativeBaseline(snapshot) };
    expect(() => f.repo.reconcileVerifiedSnapshot(reset)).toThrow("HINDSIGHT_APPLICATION_RESET_REQUIRED");
    f.repo.reconcileVerifiedSnapshot({ ...reset, reset: true });
    expect(f.repo.record({ ...nextScope, memoryId: "memory-a" })?.unit.text).toBe("Recreated generation fact");
    expect(() => f.repo.record({ ...SCOPE, memoryId: "memory-a" })).toThrow("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_bodies WHERE bank_generation=:generation AND body_id=:id")
      .get({ generation: SCOPE.namespace.bank_generation, id: source.application.body.ref.body_id })?.n).toBe(1);
  });

  it("rolls back a deferred COMMIT failure and remains usable for a later publication", () => {
    const f = fixture(); const memory = memoryFixture(); seed(f, snapshotFixture(bankFixture(), [memory]));
    f.db.exec(`CREATE TABLE application_commit_parent(id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE application_commit_child(id TEXT REFERENCES application_commit_parent(id) DEFERRABLE INITIALLY DEFERRED) STRICT;
      CREATE TRIGGER fail_application_commit AFTER UPDATE ON hindsight_application_replica_checkpoints
      BEGIN INSERT INTO application_commit_child VALUES ('absent'); END;`);
    const before = databaseState(f.db); const hidden = changePolicy(memory, { visibility: "hidden", policyVersion: 2 });
    const event = applicationTestEvent({ from: f.repo.checkpoint(SCOPE.bankId)!.checkpoint, native: [hidden.native], artifacts: [hidden.application] });
    expect(() => apply(f, event)).toThrow();
    expect(databaseState(f.db)).toEqual(before);
    expect(f.db.prepare("SELECT count(*) AS n FROM application_commit_child").get()?.n).toBe(0);
    f.db.exec("DROP TRIGGER fail_application_commit");
    expect(apply(f, event).checkpoint.state_cursor).toBe(1);
  });

  it("rejects an unpaired native checkpoint before any confirmed read or pending Bank admission", () => {
    const f = fixture(); seed(f, snapshotFixture(bankFixture(), [memoryFixture()]));
    f.db.exec("UPDATE hindsight_replica_sync_checkpoints SET end_cursor=end_cursor+1");
    expect(() => f.repo.record({ ...SCOPE, memoryId: "memory-a" })).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_UNPAIRED");
    expect(() => f.repo.search({ ...SCOPE, query: "verified", limit: 1 })).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_UNPAIRED");
    expect(() => f.repo.bankBinding(SCOPE.bankId)).toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_UNPAIRED");
  });
});

function tempPath() {
  const root = mkdtempSync(join(tmpdir(), "taki-application-replica-"));
  cleanup.push(() => {
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("taki-application-replica-")) throw new Error("unsafe fixture path");
    rmTempDir(target);
  });
  return join(root, "memory.sqlite");
}

function fixture(path = ":memory:", options: {
  db?: Database; now?: string; acquire?: boolean; scope?: HindsightApplicationScope; bankScope?: MemoryBankScope; onTokenize?: () => void;
} = {}) {
  const db = options.db ?? openDatabase({ path, migrations: MIGRATIONS.filter(({ version: value }) => value <= 44) });
  let closed = false; const close = () => { if (!closed && !options.db) { closed = true; db.close(); } }; cleanup.push(close);
  const scope = options.scope ?? SCOPE; let ownership = options.bankScope ?? GLOBAL; let at = options.now ?? AT;
  if (!db.prepare("SELECT epoch_id FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch").get({ epoch: EPOCH })) {
    db.prepare(`INSERT INTO canonical_memory_authority_epochs
      (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES (:epoch,'hindsight',:lineage,'active',NULL,:at,NULL,'planned-switch')`)
      .run({ epoch: EPOCH, lineage: scope.namespace.provider_lineage, at });
    db.prepare("INSERT INTO canonical_memory_authority_state(singleton,active_epoch_id,updated_at) VALUES (1,:epoch,:at)")
      .run({ epoch: EPOCH, at });
  }
  const tokenizer = createIntlSegmenterTokenizer({ stoplist: true });
  const repo = createHindsightApplicationReplicaRepo({ db, tokenizer: { tokenize: (text) => { options.onTokenize?.(); return tokenizer.tokenize(text); } },
    bankScope: () => ownership, now: () => at });
  const lease = options.acquire === false ? undefined : repo.leases.acquire({ bankId: scope.bankId, ownerId: "application-replica-test", durationMs: 60_000 });
  const input = () => ({ ...scope, authorityEpochId: EPOCH, expectedBank: { bankId: scope.bankId,
    scope: ownership.kind, characterId: ownership.characterId }, expectedCheckpoint: repo.checkpoint(scope.bankId) ?? null,
  expectedNativeCheckpoint: repo.nativeCheckpoint(scope.bankId) ?? null, lease: lease!, deadlineAt: "2026-09-11T08:01:00.000Z" });
  return { db, repo, path, scope, input, close, lease: lease!, now: (value: string) => { at = value; },
    ownership: (value: MemoryBankScope) => { ownership = value; } };
}

function version(value: ApplicationArtifactFixture) {
  return { key: value.artifact.key, revision: value.artifact.revision, record_hash: value.artifact.record_hash };
}

function bind(native: ApplicationNativeFixture, application: ApplicationArtifactFixture) {
  return { native: { ...native, head: { ...native.head, binding_state: "bound" as const, bound_artifact: version(application) } }, application };
}

function bankFixture(scope = SCOPE, bankScope: MemoryBankScope = GLOBAL) {
  const native = applicationTestNative({ payload: applicationTestBankPayload(scope), kind: "bank", scope, cursor: 1 });
  const body = applicationTestBody("application-bank.v1", { scope: bankScope,
    original_bank: null, original_provider_lineage: null, original_authority_epoch_id: null }, scope);
  return bind(native, applicationTestArtifact({ scope, key: { artifact_kind: "bank", artifact_id: "bank-policy" }, body,
    binding: { kind: "exact_native", native: native.head.version! } }));
}

function memoryFixture(input: {
  scope?: HindsightApplicationScope; policy?: Partial<TakiMemoryPolicyProjection>;
  payload?: Partial<Extract<TakiApplicationNativePayload, { memory_id: string }>>;
} = {}) {
  const scope = input.scope ?? SCOPE;
  const native = applicationTestNative({ kind: "memory_unit", scope, cursor: 2,
    payload: applicationTestMemoryPayload({ bank_id: scope.bankId, document_id: null, ...input.payload }) });
  const policy = applicationTestMemoryBody(native.head.version!);
  policy.policy = { ...policy.policy, authorityEpochId: EPOCH, bankId: scope.bankId, ...input.policy };
  const application = applicationTestArtifact({ scope, key: { artifact_kind: "memory", artifact_id: `policy-${native.head.object_id}` },
    body: applicationTestBody("application-memory.v1", policy, scope), binding: { kind: "exact_native", native: native.head.version! } });
  return { ...bind(native, application), policy };
}

function blockFixture(input: { blockId?: string; writer?: "user" | "background"; content: string; blockRevision: number; artifactRevision?: number }) {
  const blockId = input.blockId ?? "user-card";
  const body = applicationTestBody("application-block.v1", { block_id: blockId, scope: GLOBAL, content: input.content,
    block_revision: input.blockRevision, updated_at: AT, writer: input.writer ?? "user", block_contract_version: 1 });
  return applicationTestArtifact({ key: { artifact_kind: "block", artifact_id: blockId }, revision: input.artifactRevision ?? 1,
    body, binding: { kind: "core_block" } });
}

function sourceFixture(input: { artifactId?: string; documentId?: string; awaiting?: boolean; tombstoned?: boolean } = {}) {
  const metadata = { shared: '{"source":true}', sourceOnly: "[1,null]", removed: "true" };
  const native = applicationTestNative({ kind: "document", cursor: 2,
    payload: { ...applicationTestSourcePayload(), document_id: input.documentId ?? "document-a", metadata },
    source: { text: "Original source body", context: "Original source context", metadata } });
  const nativeVersion = native.head.version!; const operationId = input.awaiting ? randomUUID() : null;
  const original: TakiApplicationSourceBody = { original_source: {
    authorityEpochId: "original-epoch", bankId: "original-bank", documentId: "original-document", contentHash: null,
    retainedText: "Original source body", context: "Original source context", tags: [],
    metadata: { shared: { source: true }, sourceOnly: [1, null], removed: true }, observationScopes: "shared",
    provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: 1, timelineToSeq: 2,
      capturedAt: AT, sanitized: true, sourceRef: "original-source-witness" }, revision: 4, createdAt: AT, updatedAt: AT,
  }, encoded_metadata: metadata, original_witness: input.awaiting ? null : {
    source_kind: "document", source_id: nativeVersion.object_id, source_revision: nativeVersion.object_revision,
    source_payload_hash: nativeVersion.payload_hash }, operation_id: operationId };
  const application = applicationTestArtifact({ key: { artifact_kind: "source", artifact_id: input.artifactId ?? "source-a" },
    body: applicationTestBody("application-source.v1", original), tombstoned: input.tombstoned,
    binding: operationId ? { kind: "awaiting_native", operation_id: operationId, document_id: nativeVersion.object_id }
      : { kind: "exact_native", native: nativeVersion } });
  return { ...(input.awaiting ? { native, application } : bind(native, application)), original };
}

function changePolicy(memory: ReturnType<typeof memoryFixture>, patch: Partial<TakiMemoryPolicyProjection>, overrides: Partial<TakiApplicationMemoryBody> = {}) {
  const policy = { ...memory.policy, ...overrides, policy: { ...memory.policy.policy, ...patch } };
  return { ...bind(memory.native, applicationTestArtifact({ key: memory.application.artifact.key,
    body: applicationTestBody("application-memory.v1", policy), binding: { kind: "exact_native", native: memory.native.head.version! },
    revision: memory.application.artifact.revision + 1 })), policy };
}

function snapshotFixture(bank: ReturnType<typeof bankFixture>, memories: Array<ReturnType<typeof memoryFixture>>) {
  return applicationTestSnapshot({ scope: { bankId: bank.application.artifact.bank_id, namespace: bank.application.artifact.namespace },
    native: [bank.native, ...memories.map((value) => value.native)], artifacts: [bank.application, ...memories.map((value) => value.application)] });
}

function seed(f: ReturnType<typeof fixture>, bundle: HindsightApplicationBundle) {
  return f.repo.seedVerifiedSnapshot({ ...f.input(), bundle, nativeBaseline: applicationTestNativeBaseline(bundle) });
}

function apply(f: ReturnType<typeof fixture>, event: HindsightApplicationEvent, checkpoint = f.repo.checkpoint(f.scope.bankId)!) {
  return f.repo.applyEvent({ ...f.input(), event, expectedCheckpoint: checkpoint,
    expectedNativeCheckpoint: checkpoint.native });
}

function databaseState(db: Database) {
  const tables = ["hindsight_application_replica_bodies", "hindsight_application_replica_artifacts", "hindsight_application_replica_heads",
    "hindsight_application_replica_publications", "hindsight_application_replica_publication_pages", "hindsight_application_replica_checkpoints",
    "hindsight_application_replica_projections", "hindsight_application_replica_block_restores",
    "hindsight_replica_sync_checkpoints", "hindsight_replica_sync_fts", "taki_memory_blocks"];
  return Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
