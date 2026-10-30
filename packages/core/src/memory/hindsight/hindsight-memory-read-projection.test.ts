import { describe, expect, it } from "vitest";
import { type JsonValue, type RecallRequest } from "@taki/shared";
import { APPLICATION_TEST_SCOPE as scope, APPLICATION_TEST_AT as at, applicationTestSnapshot } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBoundBank, applicationTestBoundMemory } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { projectHindsightRecall } from "./hindsight-memory-read-projection.ts";

const bankScope = { kind: "global" as const, characterId: null };
const request: RecallRequest = { bankId: scope.bankId, query: "signal", queryTimestamp: at, budget: "mid", limit: 1,
  maxTokens: 1024, factTypes: ["world", "experience", "observation"], layerIds: [], includeInvalidated: false };

describe("native candidate to application-policy recall", () => {
  it("admits a due neutral record before model assessment while excluding higher-ranked hidden/expired/mood facts", () => {
    const bank = applicationTestBoundBank();
    const nodes = [
      applicationTestBoundMemory({ payload: { memory_id: "hidden", text: "hidden signal" }, policy: { visibility: "hidden" } }),
      applicationTestBoundMemory({ payload: { memory_id: "expired", text: "expired signal" }, policy: { retention: { kind: "expiring", expiresAt: at } } }),
      applicationTestBoundMemory({ payload: { memory_id: "mood", text: "mood signal" }, policy: { visibility: "mood-gated", disclosure: "movie" } }),
      applicationTestBoundMemory({ payload: { memory_id: "visible", text: "visible signal" } }),
    ];
    const bundle = applicationTestSnapshot({ kind: "hydrate", native: [bank.native, ...nodes.map((node) => node.native)],
      artifacts: [bank.application, ...nodes.map((node) => node.application)] });
    const result = projectHindsightRecall({ ...scope, bundle, authorityEpochId: "epoch", bankScope, request, at,
      candidates: nodes.map((node, index) => ({ id: node.native.head.object_id, text: `${node.native.head.object_id} signal`, scores: { final: 1 - index / 10 } })) });
    expect(result.hits.map((hit) => hit.record.unit.memoryId)).toEqual(["visible"]);
    expect(result.hits[0]!.scores).toEqual([{ source: "provider", value: 0.7, higherIsBetter: true }]);
    expect(nodes[3]!.value.assessment.state).toBe("due");
    expect(result.needsBinding).toBe(false);
  });

  it("never labels an older native candidate with a newer hydrated revision after a text edit", () => {
    const bank = applicationTestBoundBank(); const memory = applicationTestBoundMemory({ payload: { text: "new signal", revision: 8 } });
    const bundle = applicationTestSnapshot({ kind: "hydrate", native: [bank.native, memory.native], artifacts: [bank.application, memory.application] });
    const result = projectHindsightRecall({ ...scope, bundle, authorityEpochId: "epoch", bankScope, request, at,
      candidates: [{ id: memory.native.head.object_id, text: "old signal" }] });
    expect(result).toEqual({ hits: [], needsBinding: false, stale: true });
  });

  it.each([{ sources: ["visible"] }, { sources: ["visible", "experience"] }, { sources: [] }])("admits an ordinary observation with references $sources while enforcing each record's own policy", ({ sources }) => {
    const bank = applicationTestBoundBank();
    const nodes = [
      applicationTestBoundMemory({ payload: { memory_id: "hidden", text: "hidden observation signal", fact_type: "observation" }, policy: { visibility: "hidden" } }),
      applicationTestBoundMemory({ payload: { memory_id: "expired", text: "expired observation signal", fact_type: "observation" },
        policy: { retention: { kind: "expiring", expiresAt: at } } }),
      applicationTestBoundMemory({ payload: { memory_id: "invalidated", text: "invalidated observation signal", fact_type: "observation",
        state: "invalidated", invalidated_at: at, invalidation_reason: "fixture" } }),
      applicationTestBoundMemory({ payload: { memory_id: "derived", text: "ordinary observation signal",
        fact_type: "observation", source_memory_ids: sources } }),
      applicationTestBoundMemory({ payload: { memory_id: "visible", text: "visible signal", fact_type: "world" } }),
      applicationTestBoundMemory({ payload: { memory_id: "experience", text: "experienced signal", fact_type: "experience" } }),
    ];
    const bundle = applicationTestSnapshot({ kind: "hydrate", native: [bank.native, ...nodes.map((node) => node.native)],
      artifacts: [bank.application, ...nodes.map((node) => node.application)] });
    const result = projectHindsightRecall({ ...scope, bundle, authorityEpochId: "epoch", bankScope, request, at,
      candidates: nodes.map((node) => {
        const content = node.native.body.content;
        if (content.body_schema !== "application-native-record.v1" || !("memory_id" in content.value.payload)) throw new Error("fixture memory missing");
        return { id: node.native.head.object_id, text: content.value.payload.text };
      }) });
    expect(result.hits.map((hit) => hit.record.unit.memoryId)).toEqual(["derived", "visible", "experience"]);
    expect(result.hits[0]!.record.unit.sourceMemoryIds).toEqual(sources);
    expect(result).toMatchObject({ needsBinding: false, stale: false });
    expect(nodes[3]!.value).toMatchObject({ policy_basis: "neutral", assessment: { state: "due" } });
  });

  it("reports authenticated missing binding separately from corrupt existing policy", () => {
    const bank = applicationTestBoundBank(); const memory = applicationTestBoundMemory();
    memory.native.head = { ...memory.native.head, binding_state: "binding_missing", bound_artifact: null };
    const bundle = applicationTestSnapshot({ kind: "hydrate", native: [bank.native, memory.native], artifacts: [bank.application] });
    expect(projectHindsightRecall({ ...scope, bundle, authorityEpochId: "epoch", bankScope, request, at,
      candidates: [{ id: "memory-a", text: "A verified fixture fact" }] }).needsBinding).toBe(true);
    const corrupt = applicationTestBoundMemory(); corrupt.application.body.bytes[0] = 0;
    const bad = applicationTestSnapshot({ kind: "hydrate", native: [bank.native, corrupt.native], artifacts: [bank.application, corrupt.application] });
    expect(() => projectHindsightRecall({ ...scope, bundle: bad, authorityEpochId: "epoch", bankScope, request, at,
      candidates: [{ id: "memory-a", text: "A verified fixture fact" }] })).toThrow("BODY_INTEGRITY");
  });

  it("preserves special own metadata keys and deep values without treating JSON-looking strings as typed data", () => {
    let nested: JsonValue = "leaf"; for (let depth = 0; depth < 1100; depth++) nested = { next: nested };
    const metadata = Object.fromEntries([["__proto__", { preserved: true }], ["constructor", "literal"], ["nested", nested], ["looks_json", '{"a":1}']]);
    const bank = applicationTestBoundBank(); const memory = applicationTestBoundMemory({ payload: { metadata } });
    const bundle = applicationTestSnapshot({ kind: "hydrate", native: [bank.native, memory.native], artifacts: [bank.application, memory.application] });
    const result = projectHindsightRecall({ ...scope, bundle, authorityEpochId: "epoch", bankScope, request, at,
      candidates: [{ id: "memory-a", text: "A verified fixture fact", metadata }] });
    const restored = result.hits[0]!.record.unit.metadata;
    expect(Object.hasOwn(restored, "__proto__")).toBe(true); expect(restored["__proto__"]).toEqual({ preserved: true });
    expect(restored["looks_json"]).toBe('{"a":1}');
    let value = restored["nested"]; for (let depth = 0; depth < 1100; depth++) value = (value as Record<string, JsonValue>)["next"];
    expect(value).toBe("leaf");
  });
});
