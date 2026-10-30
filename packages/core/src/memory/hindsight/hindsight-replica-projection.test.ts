import { describe, expect, it } from "vitest";
import { HindsightLogicalSnapshotRecordSchema, type CanonicalMemoryRecord } from "@taki/shared";
import { projectHindsightReplicaRecord, type HindsightReplicaProjection } from "./hindsight-replica-projection.ts";

const at = "2026-09-08T00:00:00.000Z";
const provenance: CanonicalMemoryRecord["provenance"] = { actor: "user", origin: "explicit-user", characterId: null,
  timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true, sourceRef: null };
const policy: CanonicalMemoryRecord["policy"] = { authorityEpochId: "target", bankId: "bank", memoryId: "native",
  layerId: "profile", importance: 5, visibility: "retrieved", disclosure: null, origin: "self", emotionalWeight: null,
  retention: { kind: "permanent" }, policyVersion: 1, updatedAt: at };
const legacy: HindsightReplicaProjection = { bankScope: () => ({ kind: "global", characterId: null }),
  source: () => ({ retainedText: "retained source", context: null, provenance }), memory: () => ({ policy, provenance }) };

describe("explicit typed replica projection seams", () => {
  it("keeps old injected source projections compatible and applies explicitly restored document metadata", () => {
    const native = HindsightLogicalSnapshotRecordSchema.parse({ objectKind: "document", objectId: "doc", objectRevision: 3,
      payload: { kind: "document", value: { bankId: "bank", documentId: "doc", contentHash: "a".repeat(64),
        metadata: { value: "1" }, tags: ["native"], observationScopes: null, createdAt: at, updatedAt: at } } });
    const context = { bankId: "bank", authorityEpochId: "target", projection: legacy };
    expect(projectHindsightReplicaRecord(native, context).payload).toMatchObject({ kind: "document", value: {
      retainedText: "retained source", context: null, metadata: { value: "1" }, revision: 3, tags: ["native"],
    } });
    const projection = { ...legacy, source: () => ({ retainedText: "retained source", context: "", provenance, metadata: { value: 1 } }) };
    expect(projectHindsightReplicaRecord(native, { ...context, projection }).payload).toMatchObject({ kind: "document", value: {
      metadata: { value: 1 }, context: "", contentHash: "a".repeat(64), revision: 3, tags: ["native"],
    } });
  });

  it("keeps legacy strings and restricts unit enrichment to the explicit metadata/policy/provenance outputs", () => {
    const native = HindsightLogicalSnapshotRecordSchema.parse({ objectKind: "memory_unit", objectId: "native", objectRevision: 2,
      payload: { kind: "memory_unit", value: { bankId: "bank", memoryId: "native", documentId: "doc", chunkId: "chunk",
        text: "native content", context: "native context", factType: "experience", state: "valid", revision: 2,
        tags: ["native-tag", "taki-layer:profile"], metadata: { value: "1" }, entities: ["native entity"], sourceMemoryIds: ["other"],
        observationScopes: null, eventDate: at, occurredStart: null, occurredEnd: null, mentionedAt: at, createdAt: at,
        updatedAt: at, editedAt: at, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null,
        invalidatedAt: null, proofCount: 1 } } });
    const context = { bankId: "bank", authorityEpochId: "target", projection: legacy };
    expect(projectHindsightReplicaRecord(native, context).payload).toMatchObject({ kind: "memory_unit", value: { unit: { metadata: { value: "1" } } } });
    const projection = { ...legacy, memory: () => ({ policy, provenance, unitMetadata: { value: 1 } }) };
    expect(projectHindsightReplicaRecord(native, { ...context, projection }).payload).toMatchObject({ kind: "memory_unit", value: {
      unit: { text: "native content", context: "native context", metadata: { value: 1 }, memoryId: "native", revision: 2,
        tags: ["native-tag", "taki-layer:profile"], entities: ["native entity"], sourceMemoryIds: ["other"] },
    } });
  });
});
