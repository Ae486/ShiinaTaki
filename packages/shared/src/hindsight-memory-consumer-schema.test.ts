import { describe, expect, it } from "vitest";
import {
  HindsightMemoryMutationEnvelopeV1Schema, HindsightMemoryMutationResultV1Schema,
  HindsightMemoryRecallEnvelopeV1Schema, HindsightMemoryRecallResultV1Schema,
  HindsightMemoryReflectResultV1Schema, HindsightMemoryRetainCompletedResultV1Schema,
  HindsightMemoryRetainResultV1Schema,
} from "./hindsight-memory-consumer-schema.ts";
import { RecallResultSchema, ReflectResultSchema, RetainResultSchema } from "./memory-provider-operation-schema.ts";
import type { CanonicalMemoryRecord, JsonValue } from "./memory-provider-domain-schema.ts";

const at = "2026-09-11T08:00:00.000Z";
const capabilities = { providerId: "hindsight", contractVersion: 1 as const, retain: true, recall: true, reflect: true,
  edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true,
  sparseRetrieval: true, vectorRetrieval: "ready" as const, derivedMemoryRead: true };

function metadata(depth = 0): Record<string, JsonValue> {
  let value: Record<string, JsonValue> = JSON.parse('{"__proto__":{"nested":[false,null,3,""]},"constructor":{"prototype":"data"},"text":"{\\"keep\\":true}"}');
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
}
function record(value = metadata()): CanonicalMemoryRecord {
  return {
    unit: { authorityEpochId: "epoch", bankId: "bank", memoryId: "memory", documentId: null, chunkId: null,
      text: "A current fact", context: null, factType: "world", state: "valid", revision: 3,
      tags: ["taki-layer:profile"], metadata: value, entities: [], sourceMemoryIds: [], observationScopes: null,
      eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: null, createdAt: at, updatedAt: at,
      editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 },
    policy: { authorityEpochId: "epoch", bankId: "bank", memoryId: "memory", layerId: "profile", importance: 5,
      visibility: "retrieved", disclosure: null, origin: "observed", emotionalWeight: null,
      retention: { kind: "permanent" }, policyVersion: 1, updatedAt: at },
    provenance: { actor: "system", origin: "provider-derived", characterId: null, timelineFromSeq: null,
      timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: null },
  };
}
function recall(value = record()) {
  return { hits: [{ record: value, confirmed: true, scores: [] }], returned: 1, truncated: false,
    vectorState: "ready" as const, partial: false, branchFailures: [] };
}
function pending(value = record()) {
  return { confirmed: false as const, authorityEpochId: "epoch", bankId: "bank", operationId: "op", originalAt: at,
    phase: "queued" as const, operation: { kind: "mutation" as const,
      request: { kind: "restore" as const, bankId: "bank", memoryId: "memory", expectedRevision: 3 } }, targetRecord: value };
}
function envelope(data: unknown) {
  return { ok: true as const, requestId: "request", providerId: "hindsight", authorityEpochId: "epoch", capabilities, data };
}

describe("D77 Hindsight consumer V1 adapters", () => {
  it("preserves deep Canonical JSON and special own keys without changing the frozen parser", () => {
    const value = metadata(10_000);
    const result = HindsightMemoryRecallResultV1Schema.parse(recall(record(value)));
    expect(result.hits[0]?.record.unit.metadata).toBe(value);
    const shallow = recall();
    const adapted = HindsightMemoryRecallResultV1Schema.parse(shallow).hits[0]!.record.unit.metadata;
    expect(Object.hasOwn(adapted, "__proto__")).toBe(true);
    expect(adapted.constructor).toEqual({ prototype: "data" });
    expect(adapted.text).toBe('{"keep":true}');
    expect(Object.hasOwn(RecallResultSchema.parse(shallow).hits[0]!.record.unit.metadata, "__proto__")).toBe(false);
  });

  it("preserves Pending target evidence and still enforces its exact identity", () => {
    const value = record(metadata(10_000));
    const data = { ...recall(), pending: [pending(value)] };
    expect(HindsightMemoryRecallResultV1Schema.parse(data).pending?.[0]?.targetRecord?.unit.metadata).toBe(value.unit.metadata);
    const wrong = pending({ ...value, unit: { ...value.unit, revision: 4 } });
    expect(HindsightMemoryRecallResultV1Schema.safeParse({ ...recall(), pending: [wrong] }).success).toBe(false);
    const wrongPolicy = record(); wrongPolicy.policy.bankId = "another-bank";
    expect(HindsightMemoryRecallResultV1Schema.safeParse(recall(wrongPolicy)).success).toBe(false);
  });

  it.each(["applied", "unchanged", "superseded"] as const)("preserves deep %s mutation records", (outcome) => {
    const value = record(metadata(10_000));
    const result = HindsightMemoryMutationResultV1Schema.parse({ outcome, record: value });
    expect(result.record?.unit.metadata).toBe(value.unit.metadata);
  });

  it("preserves pending mutations and refuses contradictory target revisions", () => {
    const value = record(metadata(10_000));
    const result = HindsightMemoryMutationResultV1Schema.parse({ outcome: "pending", record: null, pending: pending(value) });
    expect(result.outcome).toBe("pending");
    if (result.outcome === "pending") expect(result.pending.targetRecord?.unit.metadata).toBe(value.unit.metadata);
    const wrong = pending(value); wrong.operation.request.expectedRevision = 2;
    expect(HindsightMemoryMutationEnvelopeV1Schema.safeParse(envelope({ outcome: "pending", record: null, pending: wrong })).success).toBe(false);
  });

  it("keeps recall count, combined limit, branch failure and envelope identity guards", () => {
    const base = recall();
    const failure = { scope: "global", code: "MEMORY_PROVIDER_UNAVAILABLE", retryable: true, nextAction: "check-provider" };
    for (const data of [
      { ...base, returned: 0 }, { ...base, partial: true }, { ...base, branchFailures: [failure] },
      { ...base, partial: true, branchFailures: [failure, failure] },
      { ...base, partial: true, branchFailures: [{ ...failure, retryable: false }] },
      { ...base, pending: Array.from({ length: 100 }, () => pending()) },
    ]) expect(HindsightMemoryRecallResultV1Schema.safeParse(data).success).toBe(false);
    expect(HindsightMemoryRecallEnvelopeV1Schema.safeParse({ ...envelope(base), providerId: "local" }).success).toBe(false);
    expect(HindsightMemoryRecallEnvelopeV1Schema.safeParse({ ...envelope(base), leaked: true }).success).toBe(false);
    expect(HindsightMemoryRecallResultV1Schema.safeParse({ ...base, partial: true, branchFailures: [failure] }).success).toBe(true);
  });

  it("preserves native reflection JSON without borrowing Canonical metadata quotas", () => {
    const structuredContent = { "": null, nested: metadata(10_000), large: "x".repeat(20_000),
      many: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`field-${index}`, index])) };
    const trace = { tool_calls: [{ name: "recall", input: metadata(), output: structuredContent }] };
    const data = { text: "Actual native reflection", structuredContent, trace,
      evidence: { memoryIds: ["memory"], mentalModelIds: [], directiveIds: [] }, usage: { inputTokens: null, outputTokens: 9 } };
    const result = HindsightMemoryReflectResultV1Schema.parse(data);
    expect(result.structuredContent).toBe(structuredContent); expect(result.trace).toBe(trace);
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: 9 });
    expect(ReflectResultSchema.safeParse({ ...data, structuredContent: { "": null }, trace: null }).success).toBe(false);
    expect(HindsightMemoryReflectResultV1Schema.safeParse({ ...data, evidence: { ...data.evidence, memoryIds: [""] } }).success).toBe(false);
    expect(HindsightMemoryReflectResultV1Schema.safeParse({ ...data, structuredContent: { invalid: Infinity } }).success).toBe(false);
  });

  it("keeps complete G1 results beyond a page or the old Local 256-reference cap", () => {
    const memories = Array.from({ length: 513 }, (_, index) => ({ memoryId: `memory-${index}`, revision: index + 1 }));
    const bankProgress = [{ scope: "global", status: "completed", operationId: "op", memoryCount: 513, error: null }];
    const value = { status: "completed", documentId: "document", sourceRevision: 8, memories, bankProgress };
    const result = HindsightMemoryRetainCompletedResultV1Schema.parse(value);
    expect(result.memories).toEqual(memories); expect(result.bankProgress?.[0]?.memoryCount).toBe(513);
    expect(RetainResultSchema.safeParse(value).success).toBe(false);
    const partial = { status: "pending", operationId: "parent", documentId: "document", sourceRevision: 8, memories,
      bankProgress: [...bankProgress, { scope: "character", status: "pending", operationId: "character-op", memoryCount: 0, error: null }] };
    expect(HindsightMemoryRetainResultV1Schema.safeParse(partial).success).toBe(true);
    for (const data of [
      { ...value, memories: [] }, { ...value, zeroResult: true },
      { ...value, memories: [{ memoryId: "memory", revision: 0 }] },
      { ...value, bankProgress: partial.bankProgress }, { ...value, bankProgress: [...bankProgress, ...bankProgress] },
      { ...value, bankProgress: [{ ...bankProgress[0], memoryCount: -1 }] },
    ]) expect(HindsightMemoryRetainCompletedResultV1Schema.safeParse(data).success).toBe(false);
    expect(HindsightMemoryRetainCompletedResultV1Schema.safeParse({ ...value, memories: [], zeroResult: true }).success).toBe(true);
  });
});
