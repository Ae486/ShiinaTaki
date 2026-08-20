import { describe, expect, it } from "vitest";
import { createCanonicalMemoryTools } from "./canonical-memory-tools.ts";

describe("canonical memory tools", () => {
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
});
