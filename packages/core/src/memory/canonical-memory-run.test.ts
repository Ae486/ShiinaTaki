import { describe, expect, it, vi } from "vitest";
import type { MemoryAuthorityEpoch, MemoryProviderCapabilities, MemoryResult, RecallRequest } from "@taki/shared";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import { createCanonicalMemoryRun } from "./canonical-memory-run.ts";
import type { MemoryProvider, MemoryProviderCallContext } from "./memory-provider.ts";
import { memoryEffectMetadata } from "./canonical-tools/memory-effect-tool.ts";

const at = "2026-09-10T00:00:00.000Z";
const initialEpoch: MemoryAuthorityEpoch = { epochId: "epoch", providerId: "local", providerLineageId: "lineage",
  mode: "authority", status: "active", predecessorEpochId: null, startedAt: at, endedAt: null, reason: "initial-local" };
const initialCaps: MemoryProviderCapabilities = { providerId: "local", contractVersion: 1, retain: true, recall: true,
  reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true,
  sparseRetrieval: true, vectorRetrieval: "ready", derivedMemoryRead: false };
const recallRequest: RecallRequest = { bankId: "global", query: "memory", queryTimestamp: null, budget: "low", limit: 8,
  maxTokens: 1024, factTypes: ["experience"], layerIds: [], includeInvalidated: false };
const toolInput = { query: "memory", scope: "global", limit: 8, maxTokens: 1024 };
const toolOptions = { toolCallId: "call", messages: [] };

function fixture() {
  const state: { epoch: MemoryAuthorityEpoch; caps: MemoryProviderCapabilities; afterCall?: () => void } = {
    epoch: { ...initialEpoch }, caps: { ...initialCaps },
  };
  const success = <T>(context: MemoryProviderCallContext, data: T): MemoryResult<T> => ({ ok: true,
    requestId: context.requestId, authorityEpochId: context.authorityEpochId, providerId: state.caps.providerId,
    capabilities: { ...state.caps }, data });
  const recall = vi.fn(async (context: MemoryProviderCallContext, request: RecallRequest) => {
    void request;
    state.afterCall?.();
    return success(context, { hits: [], returned: 0, truncated: false, vectorState: state.caps.vectorRetrieval,
      partial: false, branchFailures: [] });
  });
  const mutate = vi.fn(async (context: MemoryProviderCallContext) => {
    state.afterCall?.(); return success(context, { outcome: "not_found" as const, record: null });
  });
  const capabilities = vi.fn(async () => state.caps);
  const provider: MemoryProvider = { providerId: "local", providerLineageId: "lineage", capabilities, recall, mutate,
    retain: async (context) => success(context, { status: "completed", documentId: "doc", sourceRevision: 1, memories: [], zeroResult: true }),
    reflect: async () => { throw new Error("unsupported"); } };
  const providers = new Map([["local", provider]]);
  const coordinator = createMemoryCoordinator({ providers, authority: { authorityEpoch: (expected) => {
    if (expected && expected !== state.epoch.epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    return state.epoch;
  } } });
  const routerState = { character: "taki" };
  const router = { globalBankId: () => "global", characterBankId: () => `character:${routerState.character}`,
    characterId: () => routerState.character };
  return { state, provider, providers, coordinator, router, routerState, capabilities, recall, mutate };
}

describe("immutable memory Run binding", () => {
  it("uses one real capability snapshot for coordinator, tools, and Run evidence", async () => {
    const f = fixture();
    const run = await createCanonicalMemoryRun({ coordinator: f.coordinator, router: f.router });
    expect(f.capabilities).toHaveBeenCalledTimes(1);
    expect(Object.keys(run.tools).sort()).toEqual(["invalidate_memory", "recall", "restore_memory", "retain", "update_memory"]);
    expect(memoryEffectMetadata(run.tools.recall!)?.capabilities).toBe(run.snapshot.capabilities);
    expect(memoryEffectMetadata(run.tools.recall!)?.capabilityDigest).toBe(run.snapshot.capabilityDigest);
    expect(run.snapshot).toMatchObject({ providerId: "local", providerLineageId: "lineage", authorityEpochId: "epoch", contractVersion: 1 });
    expect(Object.isFrozen(run.snapshot)).toBe(true);
    expect(Object.isFrozen(run.snapshot.capabilities)).toBe(true);
    expect(Reflect.set(run.tools, "memory_search", {})).toBe(false);
    expect(Reflect.set(run.tools.recall!, "description", "different tool")).toBe(false);
    expect(Reflect.set(run.tools.recall!, "execute", vi.fn())).toBe(false);
  });

  it("never re-resolves admission capabilities when its bound coordinator is queried", async () => {
    const f = fixture(); const captured = await f.coordinator.captureRun();
    f.state.caps.recall = false;
    expect(await captured.coordinator.capabilities()).toBe(captured.snapshot.capabilities);
    expect(captured.snapshot.capabilities.recall).toBe(true);
    expect(f.capabilities).toHaveBeenCalledTimes(1);
    expect(await captured.coordinator.recall(recallRequest)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(f.recall).not.toHaveBeenCalled();
  });

  it("keeps Character routes even when active selection changes before tool execution", async () => {
    const f = fixture(); const run = await createCanonicalMemoryRun({ coordinator: f.coordinator, router: f.router });
    f.routerState.character = "other";
    await run.tools.recall!.execute!({ ...toolInput, scope: "character" }, toolOptions as never);
    expect(f.recall).toHaveBeenCalledTimes(1);
    expect(f.recall.mock.calls[0]?.[1].bankId).toBe("character:taki");
  });

  it("refuses old-run tool calls after a provider selection change without dispatching either provider", async () => {
    const f = fixture(); const run = await createCanonicalMemoryRun({ coordinator: f.coordinator, router: f.router });
    const replacement = { ...f.provider, providerId: "hindsight", providerLineageId: "foreign", recall: vi.fn(f.provider.recall) };
    f.providers.set("hindsight", replacement);
    f.state.epoch = { ...f.state.epoch, epochId: "new-epoch", providerId: "hindsight", providerLineageId: "foreign" };
    const result = await run.tools.recall!.execute!(toolInput, toolOptions as never);
    expect(result).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(f.recall).not.toHaveBeenCalled(); expect(replacement.recall).not.toHaveBeenCalled();
  });

  it("refuses a replacement provider object and an altered executable method under the same identity", async () => {
    const f = fixture(); const captured = await f.coordinator.captureRun();
    const replacement = { ...f.provider, recall: vi.fn((context: MemoryProviderCallContext, request: RecallRequest) => f.recall(context, request)) };
    f.providers.set("local", replacement);
    expect(await captured.coordinator.recall(recallRequest)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    f.providers.set("local", f.provider);
    f.provider.recall = replacement.recall;
    expect(await captured.coordinator.recall(recallRequest)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(replacement.recall).not.toHaveBeenCalled(); expect(f.recall).not.toHaveBeenCalled();
  });

  it.each(["retain", "recall", "reflect", "edit", "invalidate", "restore", "conditionalMutation", "idempotentWrites", "sparseRetrieval", "derivedMemoryRead"] as const)(
    "rejects stable %s capability drift before calling the admitted provider", async (key) => {
      const f = fixture(); const captured = await f.coordinator.captureRun(); f.state.caps[key] = !f.state.caps[key];
      expect(await captured.coordinator.recall(recallRequest)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
      expect(f.recall).not.toHaveBeenCalled();
    });

  it("permits honest vector-health degradation across repeated recalls without rewriting the snapshot", async () => {
    const f = fixture(); const run = await createCanonicalMemoryRun({ coordinator: f.coordinator, router: f.router });
    f.state.afterCall = () => { f.state.caps.vectorRetrieval = "degraded"; };
    for (let index = 0; index < 2; index += 1) {
      expect(await run.tools.recall!.execute!(toolInput, toolOptions as never)).toMatchObject({ ok: true, data: { vectorState: "degraded" } });
    }
    expect(run.snapshot.capabilities.vectorRetrieval).toBe("ready");
    expect(memoryEffectMetadata(run.tools.recall!)?.capabilityDigest).toBe(run.snapshot.capabilityDigest);
    expect(f.recall).toHaveBeenCalledTimes(2);
    expect(await run.tools.restore_memory!.execute!({ memoryId: "m", expectedRevision: 1, scope: "global" }, toolOptions as never))
      .toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(f.mutate).not.toHaveBeenCalled();
  });

  it("refuses contract-version and provider-lineage drift before any admitted operation", async () => {
    const f = fixture(); const captured = await f.coordinator.captureRun();
    f.state.caps = { ...f.state.caps, contractVersion: 2 as 1 };
    expect(await captured.coordinator.recall(recallRequest)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    f.state.caps = { ...initialCaps };
    Reflect.set(f.provider, "providerLineageId", "changed-lineage");
    expect(await captured.coordinator.mutate({ kind: "restore", bankId: "global", memoryId: "m", expectedRevision: 1 }))
      .toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(f.recall).not.toHaveBeenCalled(); expect(f.mutate).not.toHaveBeenCalled();
  });

  it("returns unknown for writes when vector health changes only after dispatch", async () => {
    const f = fixture(); const captured = await f.coordinator.captureRun();
    f.state.afterCall = () => { f.state.caps.vectorRetrieval = "degraded"; };
    expect(await captured.coordinator.mutate({ kind: "restore", bankId: "global", memoryId: "m", expectedRevision: 1 }))
      .toMatchObject({ ok: false, error: { code: "MEMORY_OUTCOME_UNKNOWN" } });
    expect(f.mutate).toHaveBeenCalledTimes(1);
  });

  it("rechecks authority after an asynchronous capability read before dispatch", async () => {
    const f = fixture(); const captured = await f.coordinator.captureRun();
    f.capabilities.mockImplementationOnce(async () => {
      f.state.epoch = { ...f.state.epoch, epochId: "changed" }; return f.state.caps;
    });
    expect(await captured.coordinator.recall(recallRequest)).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
    expect(f.recall).not.toHaveBeenCalled();
  });
});
