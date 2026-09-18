import { describe, expect, it } from "vitest";
import { TakiApplicationAssessmentSchema, TakiApplicationMemoryBodySchema } from "./memory-policy-assessment-schema.ts";

const at = "2026-09-11T08:00:00.000Z";
const target = { object_kind: "memory_unit", object_id: "native-unit", object_revision: 7,
  payload_hash: "a".repeat(64), native_cursor: 12 };
const due = { state: "due", target, attempts: 0, next_attempt_at: null, last_failure_code: null,
  prompt_version: null, prompt_hash: null, completed_at: null };
const provenance = { actor: "agent", origin: "explicit-agent", characterId: null,
  timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: "exact-unit-evidence" };
const policy = { authorityEpochId: "original-epoch", bankId: "original-bank", memoryId: "original-unit",
  layerId: "profile", importance: 6, visibility: "hidden", disclosure: null, origin: "self", emotionalWeight: 0.4,
  retention: { kind: "permanent" }, policyVersion: 9, updatedAt: at };

describe("independent policy assessment evidence", () => {
  it.each([
    due,
    { ...due, state: "not_required" },
    { ...due, state: "failed", attempts: 1, next_attempt_at: at, last_failure_code: "model_unavailable" },
    { ...due, state: "assessed", attempts: 2, prompt_version: "policy-v1", prompt_hash: "b".repeat(64), completed_at: at },
  ])("round-trips the actual $state state without inventing model evidence", (input) => {
    expect(TakiApplicationAssessmentSchema.parse(input)).toEqual(input);
  });

  it.each([
    { state: "not_required", attempts: 1 },
    { state: "not_required", next_attempt_at: at },
    { state: "due", completed_at: at },
    { state: "due", last_failure_code: "model_failed" },
    { state: "due", prompt_version: "policy-v1" },
    { state: "due", prompt_hash: "b".repeat(64) },
    { state: "failed", attempts: 0, last_failure_code: "model_failed", next_attempt_at: at },
    { state: "failed", attempts: 1, last_failure_code: null, next_attempt_at: at },
    { state: "failed", attempts: 1, last_failure_code: "model_failed", next_attempt_at: null },
    { state: "assessed", attempts: 1, completed_at: at },
    { state: "assessed", attempts: 0, prompt_version: "policy-v1", prompt_hash: "b".repeat(64), completed_at: at },
    { state: "assessed", attempts: 1, prompt_version: "policy-v1", prompt_hash: "b".repeat(64), completed_at: at, next_attempt_at: at },
    { attempts: Number.MAX_SAFE_INTEGER + 1 },
    { target: { ...target, native_cursor: undefined } },
    { target: { ...target, object_revision: 0 } },
    { target: { ...target, payload_hash: "not-a-hash" } },
    { next_attempt_at: "2026-09-11 08:00:00" },
    { pending_phase: "confirmed" },
  ])("rejects inconsistent or incomplete evidence %#", (patch) => {
    expect(TakiApplicationAssessmentSchema.safeParse({ ...due, ...patch }).success).toBe(false);
  });
});

describe("application memory body", () => {
  it("preserves original identities and lossless unit metadata independently of the current target", () => {
    const input = body();
    const result = TakiApplicationMemoryBodySchema.parse(input);
    expect(result).toEqual(input);
    expect(result.original_record?.unit.memoryId).toBe("original-unit");
    expect(result.assessment.target.object_id).toBe("native-unit");
    expect(Object.hasOwn(result.original_record!.unit.metadata, "__proto__")).toBe(true);
    expect(result.original_record!.unit.metadata["constructor"]).toEqual({ typed: null });
    expect({}).not.toHaveProperty("polluted");
  });

  it("keeps null evidence explicit and permits encoded metadata strings larger than Canonical strings", () => {
    const input = { ...body(), original_record: null,
      encoded_metadata: JSON.parse('{"__proto__":"native-string","constructor":[],"typed":"[null,1]"}') as Record<string, unknown> };
    input.encoded_metadata["long"] = "x".repeat(40_000);
    const result = TakiApplicationMemoryBodySchema.parse(input);
    expect(result.original_record).toBeNull();
    expect(result.encoded_metadata).toEqual(input.encoded_metadata);
    expect(Object.hasOwn(result.encoded_metadata!, "__proto__")).toBe(true);
  });

  it("does not silently loosen the original Canonical domain", () => {
    const input = body();
    input.original_record.unit.tags.push(...Array.from({ length: 128 }, (_, index) => `tag-${index}`));
    expect(TakiApplicationMemoryBodySchema.safeParse(input).success).toBe(false);
    const long = body(); long.original_record.unit.metadata["long"] = "x".repeat(16_385);
    expect(TakiApplicationMemoryBodySchema.safeParse(long).success).toBe(false);
  });

  it.each(["policy", "assessment", "provenance", "source_artifacts", "original_record", "encoded_metadata"])(
    "requires explicit %s", (key) => {
      const input: Record<string, unknown> = body(); delete input[key];
      expect(TakiApplicationMemoryBodySchema.safeParse(input).success).toBe(false);
    },
  );

  it("permits a previously curated policy while reassessment remains due or failed", () => {
    expect(TakiApplicationMemoryBodySchema.parse(body()).policy_basis).toBe("curated");
    expect(TakiApplicationMemoryBodySchema.parse({ ...body(), assessment: { ...due, state: "failed", attempts: 2,
      next_attempt_at: at, last_failure_code: "model_unavailable" } }).policy.visibility).toBe("hidden");
  });
});

function body() {
  const metadata: Record<string, unknown> = JSON.parse('{"__proto__":{"polluted":false},"constructor":{"typed":null},"empty":{},"array":[],"string":"[null,1]"}');
  const unit = { authorityEpochId: "original-epoch", bankId: "original-bank", memoryId: "original-unit",
    documentId: "original-source", chunkId: null, text: "A preserved unit", context: null,
    factType: "world", state: "valid", revision: 4, tags: ["taki-layer:profile"], metadata,
    entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: null, occurredStart: null,
    occurredEnd: null, mentionedAt: null, createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null,
    consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
  return { policy_basis: "curated", policy, assessment: due, provenance,
    source_artifacts: [{ key: { artifact_kind: "source", artifact_id: "original-source-artifact" },
      revision: 3, record_hash: "c".repeat(64) }], original_record: { unit, policy, provenance }, encoded_metadata: null };
}
