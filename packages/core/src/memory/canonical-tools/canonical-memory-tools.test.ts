import { describe, expect, it } from "vitest";
import { createCanonicalMemoryTools } from "./canonical-memory-tools.ts";
import { attachEffectExecutionContext } from "../../governance/governed-tool.ts";
import { memoryEffectMetadata } from "./memory-effect-tool.ts";
import { DEFAULT_INTENTIONS_DAYS } from "../../config/memory-config.ts";
import type { RetainRequest } from "@taki/shared";

describe("canonical memory tools", () => {
  it("keeps the shared Hindsight default unchanged when no Local retention override is supplied", async () => {
    const retained: RetainRequest[] = [];
    const coordinator = { capabilities: async () => ({ providerId: "hindsight", contractVersion: 1 as const,
      retain: true, recall: false, reflect: false, edit: false, invalidate: false, restore: false,
      conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true,
      vectorRetrieval: "unavailable" as const, derivedMemoryRead: false }),
    retain: async (request: RetainRequest) => { retained.push(request); return { ok: false as const }; } };
    const tools = await createCanonicalMemoryTools({ coordinator: coordinator as never,
      router: { globalBankId: () => "g", characterBankId: () => "c", characterId: () => "taki" } });
    await tools.retain!.execute!({ content: "future plan", layer: "intentions", context: null }, { toolCallId: "call", messages: [] } as never);
    expect(retained).toHaveLength(1);
    const request = retained[0]!;
    expect(request.policy.retention.kind === "expiring" &&
      Date.parse(request.policy.retention.expiresAt!) - Date.parse(request.provenance.capturedAt)).toBe(DEFAULT_INTENTIONS_DAYS * 86_400_000);
  });

  it("filters unsupported reflect and uses exact Hindsight-aligned names", async () => {
    const capabilities = async () => ({ providerId: "local", contractVersion: 1 as const, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false });
    const coordinator = { capabilities, retain: async () => ({ ok: false as const }), recall: async () => ({ ok: false as const }), reflect: async () => ({ ok: false as const }), mutate: async () => ({ ok: false as const }) };
    const tools = await createCanonicalMemoryTools({ coordinator: coordinator as never, router: { globalBankId: () => "g", characterBankId: () => "c", characterId: () => "character" } });
    expect(Object.keys(tools).sort()).toEqual(["invalidate_memory", "recall", "restore_memory", "retain", "update_memory"]);
  });
  it("passes the AI SDK abort signal into coordinator calls", async () => {
    const controller = new AbortController(); let received: AbortSignal | undefined;
    const capabilities = async () => ({ providerId: "local", contractVersion: 1 as const, retain: false, recall: true, reflect: false, edit: false, invalidate: false, restore: false, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false });
    const coordinator = { capabilities, recall: async (_request: unknown, call: { signal?: AbortSignal }) => { received = call.signal; return { ok: false as const }; } };
    const tools = await createCanonicalMemoryTools({ coordinator: coordinator as never, router: { globalBankId: () => "g", characterBankId: () => "c", characterId: () => "character" } });
    await tools.recall?.execute?.({ query: "x", scope: "global", limit: 1, maxTokens: 32 }, { toolCallId: "call", messages: [], abortSignal: controller.signal } as never);
    expect(received).toBe(controller.signal);
  });
  it("keeps one successful both-scope branch, reports the failed branch, and enforces the shared budget", async () => {
    const at = "2026-08-19T00:00:00.000Z"; const capabilities = { providerId: "local", contractVersion: 1 as const, retain: false, recall: true, reflect: false, edit: false, invalidate: false, restore: false, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const record = { unit: { authorityEpochId: "e", bankId: "g", memoryId: "m", documentId: null, chunkId: null, text: "a memory that exceeds one token", context: null, factType: "experience" as const, state: "valid" as const, revision: 1, tags: ["taki-layer:profile"], metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: at, occurredStart: null, occurredEnd: null, mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 }, policy: { authorityEpochId: "e", bankId: "g", memoryId: "m", layerId: "profile", importance: 5, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "permanent" as const }, policyVersion: 1, updatedAt: at }, provenance: { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true as const, sourceRef: null } };
    const coordinator = { capabilities: async () => capabilities, recall: async (request: { bankId: string }) => request.bankId === "g" ? { ok: true as const, requestId: "global", providerId: "local", authorityEpochId: "e", capabilities, data: { hits: [{ record, scores: [{ source: "sparse" as const, value: 1, higherIsBetter: false }], confirmed: true }], returned: 1, truncated: false, vectorState: "unavailable" as const, partial: false, branchFailures: [] } } : { ok: false as const, requestId: "character", providerId: "local", authorityEpochId: "e", capabilities, error: { code: "MEMORY_PROVIDER_UNAVAILABLE" as const, category: "availability" as const, message: "down", retryable: true, nextAction: "check-provider" as const } } };
    const tools = await createCanonicalMemoryTools({ coordinator: coordinator as never, router: { globalBankId: () => "g", characterBankId: () => "c", characterId: () => "character" } });
    const result = await tools.recall?.execute?.({ query: "memory", scope: "both", limit: 5, maxTokens: 1 }, { toolCallId: "call", messages: [] } as never) as { ok: boolean; data: { returned: number; truncated: boolean; partial: boolean; branchFailures: Array<{ scope: string }> } };
    expect(result).toMatchObject({ ok: true, data: { returned: 0, truncated: true, partial: true, branchFailures: [{ scope: "character" }] } });
  });

  it("derives deterministic branch request identities from one outer Memory Effect", async () => {
    const capabilities = { providerId: "local", contractVersion: 1 as const, retain: false, recall: true, reflect: false, edit: false, invalidate: false, restore: false, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };
    const calls: Array<{ bankId: string; requestId?: string; expectedAuthorityEpochId?: string }> = [];
    const coordinator = {
      capabilities: async () => capabilities,
      recall: async (request: { bankId: string }, call: { requestId?: string; expectedAuthorityEpochId?: string }) => {
        calls.push({ bankId: request.bankId, requestId: call.requestId, expectedAuthorityEpochId: call.expectedAuthorityEpochId });
        return { ok: false as const, requestId: call.requestId!, providerId: "local", authorityEpochId: "epoch", capabilities, error: { code: "MEMORY_PROVIDER_UNAVAILABLE" as const, category: "availability" as const, message: "down", retryable: true, nextAction: "check-provider" as const } };
      },
    };
    const tools = await createCanonicalMemoryTools({ coordinator: coordinator as never, authority: { epochId: "epoch", providerId: "local", providerLineageId: "lineage" } as never, router: { globalBankId: () => "g", characterBankId: () => "c", characterId: () => "character" } });
    const metadata = memoryEffectMetadata(tools.recall!);
    const options = attachEffectExecutionContext({ toolCallId: "call", messages: [], abortSignal: undefined }, {
      effectId: "outer-effect", runId: "run", attemptId: "attempt",
      sourceRef: { type: "memory", requestId: "outer-effect", authorityEpoch: "epoch", providerId: "local", providerLineageId: "lineage", capabilityDigest: metadata!.capabilityDigest, operation: "recall" },
      executorRef: { type: "memory", authorityEpoch: "epoch", providerId: "local", providerLineageId: "lineage", capabilityDigest: metadata!.capabilityDigest },
    });
    await tools.recall?.execute?.({ query: "x", scope: "both", limit: 2, maxTokens: 32 }, options as never);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.requestId).toMatch(/^memory-branch:(global|character):[0-9a-f]{64}$/);
    expect(calls[1]?.requestId).toMatch(/^memory-branch:(global|character):[0-9a-f]{64}$/);
    expect(calls[0]?.requestId).not.toBe(calls[1]?.requestId);
    expect(calls[0]?.expectedAuthorityEpochId).toBe("epoch");
    expect(calls[1]?.expectedAuthorityEpochId).toBe("epoch");
  });
});
