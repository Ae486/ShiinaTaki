import { describe, expect, it } from "vitest";
import { CanonicalMemoryBankSchema, CanonicalMemoryRecordSchema, CanonicalMemoryUnitSchema, MemoryAuthorityEpochSchema, MemoryErrorSchema, TakiMemoryPolicyProjectionSchema } from "./memory-provider-domain-schema.ts";

const time = "2026-08-19T00:00:00.000Z";
describe("canonical memory domain schemas", () => {
  it("rejects lifecycle contradictions and accepts a valid unit", () => {
    const base = { authorityEpochId: "e", bankId: "b", memoryId: "m", documentId: null, chunkId: null, text: "fact", context: null, factType: "experience" as const, state: "valid" as const, revision: 1, tags: ["taki-layer:episodes"], metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: time, occurredStart: null, occurredEnd: null, mentionedAt: time, createdAt: time, updatedAt: time, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
    expect(CanonicalMemoryUnitSchema.safeParse(base).success).toBe(true);
    expect(CanonicalMemoryUnitSchema.safeParse({ ...base, invalidatedAt: time }).success).toBe(false);
  });
  it("requires endedAt for closed epochs", () => {
    const epoch = { epochId: "e", providerId: "local", providerLineageId: "lineage", mode: "authority" as const, status: "closed" as const, predecessorEpochId: null, startedAt: time, endedAt: null, reason: "initial-local" as const };
    expect(MemoryAuthorityEpochSchema.safeParse(epoch).success).toBe(false);
  });
  it("keeps policy retention strict", () => {
    const policy = { authorityEpochId: "e", bankId: "b", memoryId: "m", layerId: "episodes", importance: 4, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "rolling-window" as const, days: 30 }, policyVersion: 1, updatedAt: time };
    expect(TakiMemoryPolicyProjectionSchema.safeParse(policy).success).toBe(true);
    expect(TakiMemoryPolicyProjectionSchema.safeParse({ ...policy, extra: true }).success).toBe(false);
  });
  it("rejects contradictory error dispositions and aggregate identities", () => {
    expect(MemoryErrorSchema.safeParse({ code: "MEMORY_REVISION_MISMATCH", category: "internal", message: "stale", retryable: true, nextAction: "retry" }).success).toBe(false);
    const unit = { authorityEpochId: "e", bankId: "b", memoryId: "m", documentId: null, chunkId: null, text: "fact", context: null, factType: "experience" as const, state: "valid" as const, revision: 1, tags: ["taki-layer:episodes"], metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: time, occurredStart: null, occurredEnd: null, mentionedAt: time, createdAt: time, updatedAt: time, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
    const policy = { authorityEpochId: "e", bankId: "other", memoryId: "m", layerId: "episodes", importance: 4, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "importance-decay" as const, archiveBelowImportance: 4, afterDays: 90 }, policyVersion: 1, updatedAt: time };
    const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: time, sanitized: true as const, sourceRef: null };
    expect(CanonicalMemoryRecordSchema.safeParse({ unit, policy, provenance }).success).toBe(false);
  });
  it("bounds open configuration maps", () => {
    const config = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key-${index}`, index]));
    const bank = { authorityEpochId: "e", bankId: "b", scope: { kind: "global" as const, characterId: null }, name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config, revision: 1, createdAt: time, updatedAt: time };
    expect(CanonicalMemoryBankSchema.safeParse(bank).success).toBe(false);
  });
});
