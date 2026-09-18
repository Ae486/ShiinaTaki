import { describe, expect, it } from "vitest";
import { createMemoryCoordinator } from "./memory-coordinator.ts";

describe("memory coordinator", () => {
  it("does not fallback when the selected provider rejects", async () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "l", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const provider = { providerId: "local", providerLineageId: "l", capabilities: async () => ({ providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false }), retain: async () => { throw new Error("down"); }, recall: async () => { throw new Error("down"); }, reflect: async () => { throw new Error("down"); }, mutate: async () => { throw new Error("down"); } };
    const coordinator = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const result = await coordinator.recall({ bankId: "b", query: "x", queryTimestamp: null, budget: "low", limit: 1, maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false }); expect(result.ok).toBe(false); if (result.ok) throw new Error("expected failure"); expect(result.error.code).toBe("MEMORY_INTERNAL_ERROR");
  });
  it("fails closed on malformed envelopes for every operation family", async () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "l", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const capabilities = async () => ({ providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: true, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false });
    const malformed = async () => ({ ok: true, requestId: "wrong", providerId: "local", authorityEpochId: "e", capabilities: await capabilities(), data: { leaked: "content" } });
    const provider = { providerId: "local", providerLineageId: "l", capabilities, retain: malformed, recall: malformed, reflect: malformed, mutate: malformed };
    const coordinator = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: epoch.startedAt, sanitized: true as const, sourceRef: null };
    const retain = coordinator.retain({ bankId: "b", content: "secret", context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace", provenance, policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } });
    const recall = coordinator.recall({ bankId: "b", query: "secret", queryTimestamp: null, budget: "low", limit: 1, maxTokens: 10, factTypes: ["experience"], layerIds: [], includeInvalidated: false });
    const reflect = coordinator.reflect({ bankId: "b", query: "secret", budget: "low", maxTokens: 10 });
    const mutations = [coordinator.mutate({ kind: "edit", bankId: "b", memoryId: "m", expectedRevision: 1, patch: { text: "x" } }), coordinator.mutate({ kind: "invalidate", bankId: "b", memoryId: "m", expectedRevision: 1, reason: null }), coordinator.mutate({ kind: "restore", bankId: "b", memoryId: "m", expectedRevision: 1 })];
    const [retainResult, recallResult, reflectResult, ...mutationResults] = await Promise.all([retain, recall, reflect, ...mutations]);
    for (const result of [retainResult, ...mutationResults]) { expect(result.ok).toBe(false); if (result.ok) throw new Error("expected failure"); expect(result.error.code).toBe("MEMORY_OUTCOME_UNKNOWN"); expect(result.error.message).not.toContain("secret"); }
    for (const result of [recallResult, reflectResult]) { expect(result.ok).toBe(false); if (result.ok) throw new Error("expected failure"); expect(result.error.code).toBe("MEMORY_INTERNAL_ERROR"); expect(result.error.message).not.toContain("secret"); }
  });
  it("preserves authority integrity and provider-lineage failures", async () => {
    const request = { bankId: "b", query: "x", queryTimestamp: null, budget: "low" as const, limit: 1, maxTokens: 100, factTypes: ["experience" as const], layerIds: [], includeInvalidated: false as const };
    const corrupt = createMemoryCoordinator({ authority: { authorityEpoch: () => { throw new Error("MEMORY_INTEGRITY_ERROR: corrupt pointer"); } } as never, providers: new Map() });
    const corruptResult = await corrupt.recall(request); expect(corruptResult.ok).toBe(false); if (corruptResult.ok) throw new Error("expected failure"); expect(corruptResult.error.code).toBe("MEMORY_INTEGRITY_ERROR");
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "expected", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const provider = { providerId: "local", providerLineageId: "wrong" };
    const stale = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const staleResult = await stale.recall(request); expect(staleResult.ok).toBe(false); if (staleResult.ok) throw new Error("expected failure"); expect(staleResult.error.code).toBe("MEMORY_AUTHORITY_MISMATCH");
  });
  it("rejects a returned capability snapshot that differs in any field", async () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "l", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const caps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const provider = { providerId: "local", providerLineageId: "l", capabilities: async () => caps, recall: async (context: { requestId: string; authorityEpochId: string }) => ({ ok: true as const, requestId: context.requestId, providerId: "local", authorityEpochId: context.authorityEpochId, capabilities: { ...caps, vectorRetrieval: "degraded" as const }, data: { hits: [], returned: 0, truncated: false, vectorState: "degraded" as const, partial: false, branchFailures: [] } }) };
    const coordinator = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const result = await coordinator.recall({ bankId: "b", query: "x", queryTimestamp: null, budget: "low", limit: 1, maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false });
    expect(result.ok).toBe(false); if (result.ok) throw new Error("expected failure"); expect(result.error.code).toBe("MEMORY_AUTHORITY_MISMATCH");
  });
  it("accepts vector health degradation while preserving sparse recall", async () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "l", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const initialCaps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as "unavailable" | "degraded", derivedMemoryRead: false };
    let liveCaps = initialCaps;
    const provider = {
      providerId: "local", providerLineageId: "l", capabilities: async () => liveCaps,
      recall: async (context: { requestId: string; authorityEpochId: string }) => {
        liveCaps = { ...initialCaps, vectorRetrieval: "degraded" as const };
        return { ok: true as const, requestId: context.requestId, providerId: "local", authorityEpochId: context.authorityEpochId, capabilities: liveCaps, data: { hits: [], returned: 0, truncated: false, vectorState: "degraded" as const, partial: false, branchFailures: [] } };
      },
    };
    const coordinator = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const result = await coordinator.recall({ bankId: "b", query: "x", queryTimestamp: null, budget: "low", limit: 1, maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false });
    expect(result.ok).toBe(true); if (!result.ok) throw new Error("expected recall success"); expect(result.data.vectorState).toBe("degraded");
  });
  it("fails closed when a stable capability drifts during a provider call", async () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "l", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const initialCaps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "ready" as const, derivedMemoryRead: false };
    let liveCaps = initialCaps;
    const provider = {
      providerId: "local", providerLineageId: "l", capabilities: async () => liveCaps,
      recall: async (context: { requestId: string; authorityEpochId: string }) => {
        liveCaps = { ...initialCaps, recall: false };
        return { ok: true as const, requestId: context.requestId, providerId: "local", authorityEpochId: context.authorityEpochId, capabilities: liveCaps, data: { hits: [], returned: 0, truncated: false, vectorState: "ready" as const, partial: false, branchFailures: [] } };
      },
    };
    const coordinator = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const result = await coordinator.recall({ bankId: "b", query: "x", queryTimestamp: null, budget: "low", limit: 1, maxTokens: 100, factTypes: ["experience"], layerIds: [], includeInvalidated: false });
    expect(result.ok).toBe(false); if (result.ok) throw new Error("expected failure"); expect(result.error.code).toBe("MEMORY_AUTHORITY_MISMATCH");
  });
  it("keeps a completed write uncertain when capability evidence drifts before acceptance", async () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "l", mode: "authority" as const, status: "active" as const, predecessorEpochId: null, startedAt: "2026-08-19T00:00:00.000Z", endedAt: null, reason: "initial-local" as const };
    const initialCaps = { providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    let liveCaps = initialCaps;
    const provider = {
      providerId: "local", providerLineageId: "l", capabilities: async () => liveCaps,
      mutate: async (context: { requestId: string; authorityEpochId: string }) => {
        liveCaps = { ...initialCaps, edit: false };
        return { ok: false as const, requestId: context.requestId, providerId: "local", authorityEpochId: context.authorityEpochId, capabilities: liveCaps, error: { code: "MEMORY_INTERNAL_ERROR" as const, category: "internal" as const, message: "provider could not confirm", retryable: false, nextAction: "check-provider" as const } };
      },
    };
    const coordinator = createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never, providers: new Map([["local", provider as never]]) });
    const result = await coordinator.mutate({ kind: "edit", bankId: "b", memoryId: "m", expectedRevision: 1, patch: { text: "changed" } });
    expect(result.ok).toBe(false); if (result.ok) throw new Error("expected failure"); expect(result.error.code).toBe("MEMORY_OUTCOME_UNKNOWN");
  });
});
