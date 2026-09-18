import { describe, expect, it } from "vitest";
import { MEMORY_ERROR_POLICY, type MemoryAuthorityEpoch, type RetainRequest } from "@taki/shared";
import { createMemoryCoordinator } from "./memory-coordinator.ts";
import type { MemoryProvider, MemoryProviderCallContext } from "./memory-provider.ts";

const at = "2026-09-05T00:00:00.000Z";
const epoch: MemoryAuthorityEpoch = { epochId: "epoch", providerId: "test-provider", providerLineageId: "lineage",
  status: "active", mode: "authority", predecessorEpochId: null, startedAt: at, endedAt: null, reason: "initial-local" };
const caps = { providerId: epoch.providerId, contractVersion: 1 as const, retain: true, recall: true, reflect: false,
  edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true,
  sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
const request: RetainRequest = { bankId: "bank", content: "safe source", context: null, timestamp: null, tags: [],
  entities: [], metadata: {}, observationScopes: null, documentId: "doc", strategy: null, updateMode: "replace",
  provenance: { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null, timelineToSeq: null,
    capturedAt: at, sanitized: true, sourceRef: null },
  policy: { layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self",
    emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1 } };

describe("Memory coordinator B5 result acceptance", () => {
  it.each([
    { status: "pending", operationId: "op", documentId: "doc", sourceRevision: null, memories: [] },
    { status: "completed", documentId: "doc", sourceRevision: 1, memories: [], zeroResult: true },
    { status: "pending", operationId: "op", documentId: null, sourceRevision: null, memories: [], bankProgress: [
      { scope: "global", status: "completed", operationId: "op-global", memoryCount: 2, error: null },
      { scope: "character", status: "failed", operationId: null, memoryCount: 0, error: "MEMORY_PROVIDER_UNAVAILABLE" },
    ] },
  ])("preserves an accepted $status receipt", async (data) => {
    const result = await coordinator((context) => success(context, data)).retain(request);
    expect(result).toMatchObject({ ok: true, data });
  });
  it.each(["superseded", "not_found"])("preserves %s without relabeling it as unknown", async (outcome) => {
    const result = await coordinator((context) => success(context, { outcome, record: null }))
      .mutate({ kind: "restore", bankId: "bank", memoryId: "memory", expectedRevision: 2 });
    expect(result).toMatchObject({ ok: true, data: { outcome, record: null } });
  });
  it.each(["MEMORY_OPERATION_CANCELLED", "MEMORY_OUTCOME_UNKNOWN"] as const)("preserves nested %s disposition", async (code) => {
    const [category, retryable, nextAction] = MEMORY_ERROR_POLICY[code];
    const result = await coordinator((context) => ({ ok: false, requestId: context.requestId, providerId: epoch.providerId,
      authorityEpochId: epoch.epochId, capabilities: caps,
      error: { code, category, retryable, nextAction, message: "memory operation not complete" } }))
      .retain(request);
    expect(result).toMatchObject({ ok: false, error: { code, retryable, nextAction } });
  });
  it("refuses a completed retain that still reports a failed Bank", async () => {
    const result = await coordinator((context) => success(context, { status: "completed", documentId: "doc", sourceRevision: 1,
      memories: [{ memoryId: "m", revision: 1 }], bankProgress: [
        { scope: "global", status: "completed", operationId: "op-global", memoryCount: 1, error: null },
        { scope: "character", status: "failed", operationId: null, memoryCount: 0, error: "MEMORY_PROVIDER_UNAVAILABLE" },
      ] })).retain(request);
    expect(result).toMatchObject({ ok: false, error: { code: "MEMORY_OUTCOME_UNKNOWN" } });
  });
});

function success(context: MemoryProviderCallContext, data: unknown) {
  return { ok: true, requestId: context.requestId, providerId: epoch.providerId,
    authorityEpochId: epoch.epochId, capabilities: caps, data };
}
function coordinator(result: (context: MemoryProviderCallContext) => unknown) {
  const invoke = async (context: MemoryProviderCallContext) => result(context);
  const provider = { providerId: epoch.providerId, providerLineageId: epoch.providerLineageId,
    capabilities: async () => caps, retain: invoke, mutate: invoke, recall: invoke, reflect: invoke } as MemoryProvider;
  return createMemoryCoordinator({ authority: { authorityEpoch: () => epoch } as never,
    providers: new Map([[epoch.providerId, provider]]) });
}
