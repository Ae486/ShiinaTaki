import { afterEach, describe, expect, it, vi } from "vitest";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { curatorTestBank, curatorTestRemotePolicy, type CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { publishReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { HINDSIGHT_TEMPLATE_BACKUP_BUILD } from "@taki/shared";
import { applicationTestEvent, applicationTestMemoryPayload, applicationTestNative } from "../../testing/hindsight-application-fixtures.ts";
import { applicationCommandList } from "../../db/hindsight-application-command-contract.ts";

const fixtures: ReturnType<typeof hindsightRuntimeFixture>[] = [];
afterEach(async () => { for (const value of fixtures.splice(0)) await value.close(); });
function fixture(input: Parameters<typeof hindsightRuntimeFixture>[0] = {}) { const value = hindsightRuntimeFixture(input); fixtures.push(value); return value; }
function unboundBank() {
  const bank = curatorTestBank({ memories: [] });
  for (const id of ["new-a", "new-b"]) bank.native.push(applicationTestNative({ scope: bank.scope, kind: "memory_unit", cursor: 2,
    payload: applicationTestMemoryPayload({ bank_id: bank.scope.bankId, memory_id: id, document_id: null }) }));
  return bank;
}
function consolidateLast(bank: CuratorTestBank) {
  const previous = bank.native.at(-1)!.body.content;
  if (previous.body_schema !== "application-native-record.v1" || !("memory_id" in previous.value.payload)) throw new Error("fixture unit missing");
  const from = { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state++ };
  const next = applicationTestNative({ scope: bank.scope, kind: "memory_unit", cursor: ++bank.server.cursor.native,
    payload: { ...previous.value.payload, revision: previous.value.payload.revision + 1 } });
  bank.native[bank.native.length - 1] = next;
  bank.events.push(applicationTestEvent({ scope: bank.scope, native: [next], from,
    to: { native_cursor: bank.server.cursor.native, state_cursor: bank.server.cursor.state } }));
}
function hideMemory(f: ReturnType<typeof fixture>) {
  const bank = f.banks[0]!;
  curatorTestRemotePolicy(bank, "memory-a", (body) => ({ ...body, policy_basis: "curated",
    policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
  return bank;
}

describe("application-aware snapshot and replay integration", () => {
  it("refuses the whole batch for one conflicting member, pulls, and rebuilds against the new version", async () => {
    const bank = unboundBank(); const f = fixture({ banks: [bank] }); const { state } = f.subsystem();
    const actual = bank.server.client.commitApplication;
    const commit = vi.spyOn(bank.server.client, "commitApplication").mockImplementationOnce(async (input) => {
      consolidateLast(bank);
      const refused = await actual(input);
      expect(refused.state).toBe("refused"); expect(refused.refusal?.code).toBe("native_version_conflict");
      expect(bank.artifacts.filter((entry) => entry.artifact.key.artifact_kind === "memory")).toEqual([]);
      expect(f.replica.record({ ...bank.scope, memoryId: "new-a" })).toBeUndefined();
      return refused;
    });
    await state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    expect(commit).toHaveBeenCalledTimes(2);
    const jobs = f.db.prepare("SELECT request_id,state FROM hindsight_application_command_jobs ORDER BY prepared_at,request_id").all();
    expect(jobs.map((job) => job.state)).toEqual(["refused", "completed"]);
    for (const row of jobs) expect(applicationCommandList(state.commands.get({ authorityEpochId: "epoch",
      bankId: bank.scope.bankId, requestId: String(row.request_id) })!.commands)).toHaveLength(2);
    for (const id of ["new-a", "new-b"]) expect(f.replica.record({ ...bank.scope, memoryId: id })).toBeDefined();
    expect(f.replica.nativeHead({ ...bank.scope, objectKind: "memory_unit", objectId: "new-b" })?.version?.object_revision).toBe(2);
  });

  it("preserves a completed batch across a deadline before pull and publishes it on the next sync", async () => {
    const bank = unboundBank(); const f = fixture({ banks: [bank] }); const { state } = f.subsystem();
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const deadline = Date.now() + 10_000;
    const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "binding-deadline", durationMs: 60_000 });
    const execute = state.writer.run;
    vi.spyOn(state.writer, "run").mockImplementationOnce(async (input) => {
      const result = await execute(input); expect(result.status).toBe("completed");
      // Publication checks Date timestamps; move only the wall clock after receipt persistence.
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(deadline + 1);
      return result;
    });
    try {
      await expect(state.sync.run({ bank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
        run: { lease, kind: "incremental", trigger: "manual", predecessor: before.native }, signal: new AbortController().signal,
        deadlineAt: new Date(deadline).toISOString() })).rejects.toThrow("HINDSIGHT_DEADLINE_EXCEEDED");
      expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
      expect(f.db.prepare("SELECT state FROM hindsight_application_command_jobs").all()).toEqual([{ state: "completed" }]);
      expect(f.replica.record({ ...bank.scope, memoryId: "new-a" })).toBeUndefined();
    } finally { vi.useRealTimers(); f.replica.leases.release(lease); }
    const commit = vi.spyOn(bank.server.client, "commitApplication");
    f.remote.calls.length = 0;
    await state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    expect(commit).not.toHaveBeenCalled(); expect(bank.server.receipts.size).toBe(1);
    expect(f.remote.calls.filter((call) => ["body", "part"].includes(call.operation))).toEqual([]);
    expect(f.remote.calls.filter((call) => call.operation === "change-page")).toHaveLength(1);
    for (const id of ["new-a", "new-b"]) expect(f.replica.record({ ...bank.scope, memoryId: id })).toBeDefined();
  });

  it("uses three admission requests cold and one after unchanged-identity runtime replacement without resaving evidence", async () => {
    const f = fixture(); const first = f.subsystem(); const bankId = f.banks[0]!.scope.bankId;
    const save = vi.spyOn(first.state.admission, "save");
    await first.state.service.synchronize({ bankId, context: { timeoutMs: 30_000 } });
    expect(f.remote.calls.filter((call) => call.operation.startsWith("/")).map((call) => call.operation))
      .toEqual(["/health", "/version", "/ext/taki-memory/version"]);
    expect(save).toHaveBeenCalledOnce();
    const evidence = f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all();
    await first.stop(); f.remote.calls.length = 0;
    const replacement = f.subsystem(); const resave = vi.spyOn(replacement.state.admission, "save");
    expect(replacement.state.provider.capabilitiesSnapshot()).toBeDefined();
    await replacement.state.service.synchronize({ bankId, context: { timeoutMs: 30_000 } });
    expect(f.remote.calls.filter((call) => call.operation.startsWith("/")).map((call) => call.operation))
      .toEqual(["/ext/taki-memory/version"]);
    expect(resave).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all()).toEqual(evidence);
  });

  it.each(["build", "upstream"] as const)("fully admits a changed %s in the warm manifest before saving it", async (field) => {
    const f = fixture(); const subsystem = f.subsystem(); const bankId = f.banks[0]!.scope.bankId;
    await subsystem.state.service.synchronize({ bankId, context: { timeoutMs: 30_000 } });
    const compatibility = f.remote.client.compatibility;
    vi.spyOn(f.remote.client, "compatibility").mockImplementation(async (context) => {
      const manifest = await compatibility(context);
      return { ...manifest, source_identity: { ...manifest.source_identity,
        ...(field === "build" ? { compatibility_build: HINDSIGHT_TEMPLATE_BACKUP_BUILD } : { upstream_commit: "changed-upstream" }) } };
    });
    const save = vi.spyOn(subsystem.state.admission, "save"); f.remote.calls.length = 0;
    await subsystem.state.service.synchronize({ bankId, context: { timeoutMs: 30_000 } });
    expect(f.remote.calls.filter((call) => call.operation.startsWith("/")).map((call) => call.operation))
      .toEqual(["/ext/taki-memory/version", "/health", "/version", "/ext/taki-memory/version"]);
    expect(save).toHaveBeenCalledOnce();
    f.remote.calls.length = 0; save.mockClear();
    await subsystem.state.service.synchronize({ bankId, context: { timeoutMs: 30_000 } });
    expect(f.remote.calls.filter((call) => call.operation.startsWith("/")).map((call) => call.operation))
      .toEqual(["/ext/taki-memory/version"]);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves identical admission only once when independent cold Banks finish admission together", async () => {
    const f = fixture(); const { state } = f.subsystem(); const save = vi.spyOn(state.admission, "save");
    await Promise.all(f.banks.map((bank) => state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } })));
    expect(save).toHaveBeenCalledOnce();
    for (const bank of f.banks) expect(state.replica.checkpoint(bank.scope.bankId)).toBeDefined();
  });

  it("refuses a changed live lineage before pulling still-readable historical application rows", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = f.banks[0]!;
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const evidence = f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all();
    const compatibility = f.remote.client.compatibility; const changes = f.remote.client.applicationChanges;
    vi.spyOn(f.remote.client, "compatibility").mockImplementation(async (context) => {
      const manifest = await compatibility(context);
      return { ...manifest, provider: { ...manifest.provider, lineage: "33333333-3333-4333-8333-333333333333" } };
    });
    const pull = vi.spyOn(f.remote.client, "applicationChanges");
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } }))
      .rejects.toThrow("HINDSIGHT_REPLICA_LINEAGE_MISMATCH");
    expect(pull).not.toHaveBeenCalled(); expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    expect(f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all()).toEqual(evidence);
    expect(await changes({ ...bank.scope, afterStateCursor: before.checkpoint.state_cursor, limit: 128,
      context: { timeoutMs: 30_000 } })).toMatchObject({ namespace: before.namespace });
  });

  it("keeps historical admission through an outage and requires one successful live manifest on recovery", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bankId = f.banks[0]!.scope.bankId;
    const synchronize = () => subsystem.state.service.synchronize({ bankId, context: { timeoutMs: 30_000 } });
    await synchronize();
    const evidence = f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all();
    const checkpoint = f.replica.checkpoint(bankId); const save = vi.spyOn(subsystem.state.admission, "save");
    const pull = vi.spyOn(f.remote.client, "applicationChanges");
    f.remote.control.offline = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      f.remote.calls.length = 0;
      await expect(synchronize()).rejects.toThrow("HINDSIGHT_UNREACHABLE");
      expect(f.remote.calls.map((call) => call.operation)).toEqual(["/ext/taki-memory/version"]);
      expect(subsystem.state.provider.capabilitiesSnapshot()).toMatchObject({ recall: true });
      expect(f.db.prepare("SELECT * FROM hindsight_application_runtime_admission").all()).toEqual(evidence);
    }
    expect(pull).not.toHaveBeenCalled(); expect(f.replica.checkpoint(bankId)).toEqual(checkpoint);
    f.remote.control.offline = false; f.remote.calls.length = 0;
    await synchronize();
    expect(f.remote.calls.filter((call) => call.operation.startsWith("/")).map((call) => call.operation))
      .toEqual(["/ext/taki-memory/version"]);
    expect(pull).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
  });

  it("classifies a B5-only seed rollback before application snapshots and holds automatic work", async () => {
    const f = hindsightRuntimeFixture({ seed: false }); fixtures.push(f);
    const bank = f.banks[0]!; const subsystem = f.subsystem(); const uuid = "11111111-1111-4111-8111-111111111111";
    publishReplicaCheckpoint(f.db, { previous: null, next: { bankId: bank.scope.bankId,
      providerLineageId: bank.scope.namespace.provider_lineage, bankGeneration: bank.scope.namespace.bank_generation,
      authorityEpochId: "epoch", replicaEpochId: uuid, endCursor: bank.server.cursor.native + 1,
      snapshotId: uuid, snapshotCursor: 0, snapshotManifestDigest: "a".repeat(64), manifestDigest: "b".repeat(64), verifiedAt: new Date().toISOString() } });
    const native = f.replica.nativeCheckpoint(bank.scope.bankId)!;
    const repo = createHindsightReplicaSchedulerRepo(f.db);
    const binding = { bankId: bank.scope.bankId, scope: "global" as const, characterId: null };
    repo.ensureBank({ bank: binding }); repo.requestManual({ bankId: binding.bankId, kind: "full" });
    const run = repo.claim({ bankId: binding.bankId, ownerId: "seed", leaseDurationMs: 30_000 })!;
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    await expect(subsystem.state.sync.run({ bank: binding, run, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED" });
    repo.fail({ run, errorCode: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED" });
    expect(repo.get(binding.bankId)).toMatchObject({ nextAction: "explicit_retry_required", retryDueAt: null });
    repo.requestCatchUp(binding.bankId);
    expect(repo.claim({ bankId: binding.bankId, ownerId: "automatic", leaseDurationMs: 30_000 })).toBeUndefined();
    expect(snapshot).not.toHaveBeenCalled(); expect(f.replica.checkpoint(binding.bankId)).toBeUndefined();
    expect(f.replica.nativeCheckpoint(binding.bankId)).toEqual(native);
  });

  it.each(["native", "state"] as const)("classifies an ordinary page whose %s cursor alone rolled back before any event publication", async (cursor) => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    bank.server.cursor[cursor] = before.checkpoint[`${cursor}_cursor`] - 1;
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } }))
      .rejects.toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED" });
    expect(snapshot).not.toHaveBeenCalled(); expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    expect(f.replica.nativeCheckpoint(bank.scope.bankId)).toEqual(before.native);
  });
  it("rebuilds after an authenticated replay floor reset while retaining the real native baseline identity", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    vi.spyOn(f.remote.client, "applicationChanges").mockRejectedValueOnce(new HindsightApplicationRefusal({
      error: "application_state_error", code: "state_reset_required", detail: "owned replay floor",
      checkpoint: bank.events[0]!.manifest.to_checkpoint, minimum_state_cursor: 1 }));
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const after = f.replica.checkpoint(bank.scope.bankId)!;
    expect(snapshot).toHaveBeenCalledOnce(); expect(after.checkpoint.state_cursor).toBe(1);
    expect(after.native.snapshotId).toBe(before.native.snapshotId);
    expect(after.native.snapshotManifestDigest).toBe(before.native.snapshotManifestDigest);
    expect(after.native.manifestDigest).not.toBe(before.native.manifestDigest);
    expect(after.snapshot.id).not.toBe(before.snapshot.id);
    expect(f.replica.search({ ...bank.scope, query: "fact", limit: 10 })).toEqual([]);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a", includeHidden: true })?.policy.visibility).toBe("hidden");
  });

  it("refuses a native head behind its own checkpoint as a rollback without rebuilding the replica", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    expect(before.checkpoint.state_cursor).toBeGreaterThan(0);
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    vi.spyOn(f.remote.client, "applicationChanges").mockRejectedValueOnce(new HindsightApplicationRefusal({
      error: "application_state_error", code: "state_reset_required", detail: "restored behind",
      checkpoint: { native_cursor: 0, state_cursor: before.checkpoint.state_cursor - 1 }, minimum_state_cursor: 0 }));
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } }))
      .rejects.toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED", providerLineageId: before.namespace.provider_lineage,
        bankGeneration: before.namespace.bank_generation });
    expect(snapshot).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
  });

  // A native-only restore leaves the application state cursor equal, so each cursor must refuse on its own.
  it.each(["state", "native"] as const)("refuses an explicit full run with only the %s cursor behind as a rollback before any snapshot", async (cursor) => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const current = cursor === "state" ? before.checkpoint.state_cursor : before.checkpoint.native_cursor;
    expect(current).toBeGreaterThan(0);
    expect(bank.server.cursor).toEqual({ native: before.checkpoint.native_cursor, state: before.checkpoint.state_cursor });
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    const full = () => {
      const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "explicit-full", durationMs: 30_000 });
      return subsystem.state.sync.run({ bank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
        run: { lease, kind: "full", trigger: "manual", predecessor: before.native }, signal: new AbortController().signal,
        deadlineAt: new Date(Date.now() + 30_000).toISOString() }).finally(() => f.replica.leases.release(lease));
    };
    bank.server.cursor[cursor] = current - 1;
    await expect(full()).rejects.toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED",
      providerLineageId: before.namespace.provider_lineage, bankGeneration: before.namespace.bank_generation });
    expect(snapshot).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    bank.server.cursor[cursor] = current;
    await full();
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it.each(["event-hash", "namespace"] as const)("refuses corrupt %s without publishing part of its checkpoint", async (failure) => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    const before = f.replica.checkpoint(bank.scope.bankId)!; const changes = f.remote.client.applicationChanges;
    vi.spyOn(f.remote.client, "applicationChanges").mockImplementation(async (input) => {
      const page = await changes(input);
      return failure === "namespace" ? { ...page, namespace: { ...page.namespace, bank_generation: "44444444-4444-4444-8444-444444444444" } }
        : { ...page, changes: page.changes.map((event) => ({ ...event, event_hash: "0".repeat(64) })) };
    });
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } })).rejects.toThrow();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a" })?.policy.visibility).toBe("retrieved");
  });

  it("refuses downloaded event publication after its captured Bank lease was revoked", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "owned-lost-lease", durationMs: 30_000 });
    const page = f.remote.client.applicationChangePage;
    vi.spyOn(f.remote.client, "applicationChangePage").mockImplementation(async (input) => {
      const value = await page(input); f.replica.leases.release(lease); return value;
    });
    await expect(subsystem.state.sync.run({ bank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
      run: { lease, kind: "incremental", trigger: "catch_up", predecessor: before.native }, signal: new AbortController().signal,
      deadlineAt: new Date(Date.now() + 30_000).toISOString() })).rejects.toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a" })?.policy.visibility).toBe("retrieved");
  });
});
