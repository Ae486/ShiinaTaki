import { describe, expect, it } from "vitest";
import { HindsightPreparedSourceSchema, HindsightSourceObjectBindingSchema, HindsightSourceUnitEvidenceSchema } from "./hindsight-source-evidence-schema.ts";

const at = "2026-09-08T00:00:00.000Z";
const hash = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const provenance = { actor: "user", origin: "explicit-user", characterId: null, timelineFromSeq: null,
  timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: null };

describe("versioned Hindsight source evidence", () => {
  it("preserves recursive typed JSON, finite numbers, and null versus empty contexts", () => {
    const first = HindsightPreparedSourceSchema.parse(prepared(null));
    const second = HindsightPreparedSourceSchema.parse(prepared(""));
    expect(first.source.metadata).toEqual({ number: 1, string: "1", nested: { values: [null, true, 1.5, "雪😀"] } });
    expect(first.source.context).toBeNull(); expect(second.source.context).toBe("");
    expect(first.units[0]?.record.unit.metadata).toEqual({ unitOnly: false });
    expect(first.units[0]?.record.unit.context).toBe("");
  });

  it("refuses unsupported versions and contradictory preparation status without weakening Canonical fields", () => {
    const value = prepared(null);
    expect(HindsightPreparedSourceSchema.safeParse({ ...value, schemaVersion: 2 }).success).toBe(false);
    expect(HindsightPreparedSourceSchema.safeParse({ ...value, nativeItem: { content: "text" } }).success).toBe(false);
    expect(HindsightPreparedSourceSchema.safeParse({ ...value, gapCount: 2 }).success).toBe(false);
    expect(HindsightPreparedSourceSchema.safeParse({ ...value, nativeItem: null, nativeItemHash: hash }).success).toBe(false);
  });

  it("rejects a duplicate unit, cross-document evidence, and a mismatched per-unit policy", () => {
    const value = prepared(null); const unit = value.units[0]!;
    expect(HindsightPreparedSourceSchema.safeParse({ ...value, units: [unit, unit] }).success).toBe(false);
    const foreign = structuredClone(unit); foreign.record.unit.documentId = "other";
    expect(HindsightPreparedSourceSchema.safeParse({ ...value, units: [foreign] }).success).toBe(false);
    const wrongPolicy = structuredClone(unit); wrongPolicy.record.policy.memoryId = "another";
    expect(HindsightSourceUnitEvidenceSchema.safeParse(wrongPolicy).success).toBe(false);
  });

  it("requires exact revision, namespace, source association, and an observation after the native result", () => {
    const binding = { schemaVersion: 1, bindingId: hash, evidenceId: hash, sourceBankId: "local-bank",
      bankScope: { kind: "global", characterId: null }, sourceDocumentId: "doc", sourceMemoryId: null,
      providerLineageId: id, bankGeneration: id, bankId: "native-bank", objectKind: "document", objectId: "doc",
      objectRevision: 4, nativePayloadHash: hash, operationId: id, requestHash: hash, resultHash: hash,
      nativeReceiptHash: hash, nativeThroughCursor: 8, observationKind: "snapshot", observationId: id,
      observedCursor: 8, confirmedAt: at };
    expect(HindsightSourceObjectBindingSchema.safeParse(binding).success).toBe(true);
    for (const patch of [{ objectRevision: 0 }, { objectRevision: undefined }, { bankGeneration: "unknown" },
      { sourceMemoryId: "unit" }, { objectId: "foreign" }, { observedCursor: 7 }]) {
      expect(HindsightSourceObjectBindingSchema.safeParse({ ...binding, ...patch }).success).toBe(false);
    }
    expect(HindsightSourceObjectBindingSchema.safeParse({ ...binding, objectKind: "memory_unit", objectId: id }).success).toBe(false);
  });
});

function prepared(context: string | null) {
  const source = { authorityEpochId: "local", bankId: "local-bank", documentId: "doc", contentHash: "declared-old-hash",
    retainedText: null, context, tags: [], metadata: { number: 1, string: "1", nested: { values: [null, true, 1.5, "雪😀"] } },
    observationScopes: null, provenance, revision: 1, createdAt: at, updatedAt: at };
  const unit = { authorityEpochId: "local", bankId: "local-bank", memoryId: "unit", documentId: "doc", chunkId: null,
    text: "Local unit", context: "", factType: "world", state: "valid", revision: 1, tags: ["taki-layer:profile"],
    metadata: { unitOnly: false }, entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: null,
    occurredStart: null, occurredEnd: null, mentionedAt: null, createdAt: at, updatedAt: at, editedAt: null,
    consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1 };
  const policy = { authorityEpochId: "local", bankId: "local-bank", memoryId: "unit", layerId: "profile", importance: 5,
    visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null, retention: { kind: "permanent" },
    policyVersion: 1, updatedAt: at };
  return { schemaVersion: 1, evidenceId: hash, source, sourceHash: hash, retainedTextHash: null,
    units: [{ recordHash: hash, record: { unit, policy, provenance } }], nativeItem: null, nativeItemHash: null,
    gapCount: 1, gaps: [{ code: "source_text_missing", objectKind: "document", objectId: "doc" }] };
}
