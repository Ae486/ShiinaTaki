import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunMemoryReference, TriggerRequest } from "@taki/shared";
import { createRunRepo } from "../db/run-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createMemoryRunReference } from "../memory/memory-capability-snapshot.ts";
import { createRunService, type CapturedRunSnapshot, type RunExecutionContext } from "./run-service.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const request: TriggerRequest = { triggerRequestId: "trigger", idempotencyKey: "same-run", characterId: "taki",
  initiator: "scheduled", provenance: { provider: "fixture" }, deliveryClass: "class_a", contextMode: "autonomous" };
const memory = createMemoryRunReference({ providerId: "local", providerLineageId: "lineage", authorityEpochId: "epoch", contractVersion: 1,
  capabilities: { providerId: "local", contractVersion: 1, retain: true, recall: true, reflect: false, edit: true,
    invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true,
    vectorRetrieval: "ready", derivedMemoryRead: false } });

function draft(reference: RunMemoryReference): CapturedRunSnapshot["snapshot"] {
  return { schemaVersion: "slice1.v1", characterId: request.characterId, initiator: request.initiator, provenance: request.provenance,
    deliveryClass: request.deliveryClass, contextMode: request.contextMode, modelProvider: "test", modelId: "test",
    primaryHostId: "core", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64),
    governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 }, memory: reference,
    contextDecision: { sourceCategories: ["memory"], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" },
    budget: {}, implementation: { runtimeVersion: "slice1", schemaVersion: "slice1.v1" }, sourceRefs: [] };
}

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const repo = createRunRepo(db);
  const firstContext = { memorySnapshot: memory, memoryTools: {}, dispose: vi.fn() };
  const state = { next: { context: firstContext, snapshot: draft(memory) } as CapturedRunSnapshot };
  const capture = vi.fn(async () => state.next);
  const service = () => createRunService({ repo, snapshot: { capture }, provider: "test", modelId: "test" });
  return { repo, state, service, firstContext };
}

describe("Run memory context restoration", () => {
  it.each([
    ["provider", { ...memory, providerId: "hindsight", capabilities: { ...memory.capabilities, providerId: "hindsight" } }],
    ["lineage", { ...memory, providerLineageId: "other-lineage" }],
    ["epoch", { ...memory, authorityEpochId: "other-epoch" }],
    ["contract", { ...memory, contractVersion: 2 }],
    ["capability digest", { ...memory, capabilityDigest: "f".repeat(64) }],
    ["capability value with a stale digest", { ...memory, capabilities: { ...memory.capabilities, restore: false } }],
  ] satisfies Array<[string, RunMemoryReference]>)("refuses a different %s after context loss without changing durable evidence", async (field, changed) => {
    void field;
    const f = fixture(); const original = f.service(); const admission = await original.admit(request);
    const before = f.repo.status(admission.run.runId);
    const replacement = { memorySnapshot: changed, memoryTools: {}, dispose: vi.fn() };
    f.state.next = { context: replacement, snapshot: draft(changed) };
    // A new service has an empty process-local context map while the SQLite Run/snapshot remain intact.
    const restarted = f.service();
    await expect(restarted.admit(request)).rejects.toMatchObject({ message: "MEMORY_AUTHORITY_MISMATCH",
      ok: false, requestId: admission.run.runId, providerId: "local", authorityEpochId: "epoch",
      error: { code: "MEMORY_AUTHORITY_MISMATCH", category: "authority", retryable: false, nextAction: "check-provider" } });
    expect(restarted.context(admission.run.runId)).toBeUndefined();
    expect(replacement.dispose).toHaveBeenCalledOnce(); expect(f.firstContext.dispose).not.toHaveBeenCalled();
    expect(f.repo.status(admission.run.runId)).toEqual(before);
  });

  it("restores matching memory bindings while retaining the persisted immutable snapshot", async () => {
    const f = fixture(); const admitted = await f.service().admit(request);
    const context: RunExecutionContext = { memorySnapshot: structuredClone(memory), memoryTools: {}, instructions: "restored", dispose: vi.fn() };
    f.state.next = { context, snapshot: draft(structuredClone(memory)) };
    const restarted = f.service(); const restored = await restarted.admit(request);
    expect(restored.reused).toBe(true); expect(restored.run.snapshot).toEqual(admitted.run.snapshot);
    expect(restored.snapshot).toEqual(admitted.snapshot); expect(restored.snapshot.memory).toEqual(memory);
    expect(restarted.context(admitted.run.runId)).toBe(context); expect(context.dispose).not.toHaveBeenCalled();
  });

  it("keeps an existing context and disposes a duplicate capture even when current selection has changed", async () => {
    const f = fixture(); const service = f.service(); const admitted = await service.admit(request);
    const changed = { ...memory, authorityEpochId: "different-current-epoch" };
    const replacement = { memorySnapshot: changed, memoryTools: {}, dispose: vi.fn() };
    f.state.next = { context: replacement, snapshot: draft(changed) };
    expect((await service.admit(request)).reused).toBe(true);
    expect(service.context(admitted.run.runId)).toBe(f.firstContext);
    expect(replacement.dispose).toHaveBeenCalledOnce(); expect(f.firstContext.dispose).not.toHaveBeenCalled();
  });

  it("returns terminal idempotent status without binding or validating an unused new context", async () => {
    const f = fixture(); const service = f.service(); const admitted = await service.admit(request);
    expect(service.start(admitted.run.runId, admitted.attempt.attemptId)).toBe(true);
    service.settle(admitted.run.runId, admitted.attempt.attemptId, "completed");
    const replacement = { dispose: vi.fn(), memoryTools: {} };
    f.state.next = { context: replacement, snapshot: draft({ ...memory, authorityEpochId: "changed" }) };
    const restarted = f.service(); const duplicate = await restarted.admit(request);
    expect(duplicate.run.state).toBe("completed"); expect(restarted.context(admitted.run.runId)).toBeUndefined();
    expect(replacement.dispose).toHaveBeenCalledOnce(); expect(f.firstContext.dispose).toHaveBeenCalledOnce();
  });
});
