import { describe, expect, it } from "vitest";
import { HINDSIGHT_CUTOVER_METHODS, HindsightCutoverStatusSchema, HindsightCutoverVerifyResultSchema, HindsightFactPageSchema, HindsightImportLedgerSchema, HindsightLogicalSnapshotManifestSchema, HindsightLogicalSnapshotRecordSchema, HindsightRetainRequestSchema } from "./hindsight-cutover-schema.ts";

const hash = "a".repeat(64);
const now = "2026-08-21T00:00:00.000Z";

describe("Hindsight cutover schemas", () => {
  it("keeps operator cutover projections bounded and secret-free", () => {
    expect(HINDSIGHT_CUTOVER_METHODS).toEqual({ status: "memory.hindsight.cutover.status", verify: "memory.hindsight.cutover.verify" });
    const status = { runId: "run", setupRevision: 1, phase: "ready", status: "ready", expectedPredecessorEpochId: "epoch",
      lease: { active: true, fence: 1, expiresAt: "2026-08-21T01:00:00.000Z" }, sourceCount: 1, factMappingCount: 1, checkpointCount: 1,
      operationCounts: { pending: 0, submitted: 0, processing: 0, completed: 0, mapped: 1, failed: 0, cancelled: 0, conflict: 0, excluded: 0 },
      authority: { mode: "canonical-local", epochId: "epoch" }, updatedAt: now } as const;
    expect(HindsightCutoverStatusSchema.parse(status)).toMatchObject({ phase: "ready" });
    expect(HindsightCutoverVerifyResultSchema.parse({ runId: "run", expectedRevision: 1, expectedEpochId: "epoch", eligible: true, blockingCodes: [], status })).toMatchObject({ eligible: true });
    expect(() => HindsightCutoverStatusSchema.parse({ ...status, apiKey: "secret" })).toThrow();
  });
  it("accept bounded import state and reject provider payload-shaped fields", () => {
    expect(HindsightImportLedgerSchema.parse({
      runId: "run", sourceId: "source", bankId: "bank", documentId: "document", operationId: "operation",
      contentIdentity: `sha256:${hash}`, providerContentHash: hash, attemptNo: 1, status: "submitted", operationResultHash: null, derivedUnitCount: null,
      extractionErrorCount: null, mappingComplete: false, zeroFactAllowed: false, updatedAt: now,
    })).toMatchObject({ status: "submitted" });
    expect(() => HindsightImportLedgerSchema.parse({
      runId: "run", sourceId: "source", bankId: "bank", documentId: "document", operationId: "operation",
      contentIdentity: `sha256:${hash}`, providerContentHash: hash, attemptNo: 1, status: "submitted", operationResultHash: null, derivedUnitCount: null,
      extractionErrorCount: null, mappingComplete: false, zeroFactAllowed: false, updatedAt: now, rawResponse: "secret",
    })).toThrow();
  });

  it("requires the B4 retain identity and bounded content hash", () => {
    expect(() => HindsightRetainRequestSchema.parse({ content: "hello", documentId: "doc", operationId: "op", context: null, contentIdentity: "bad", providerContentHash: hash })).toThrow();
    expect(HindsightRetainRequestSchema.parse({ content: "hello", documentId: "doc", operationId: "op", context: null, contentIdentity: `sha256:${hash}`, providerContentHash: hash })).toBeTruthy();
  });

  it("rejects incomplete or oversized fact pages", () => {
    expect(() => HindsightFactPageSchema.parse({ items: [], total: 1, limit: 1, offset: 0 })).not.toThrow();
    expect(() => HindsightFactPageSchema.parse({ items: [{ factId: "fact", documentId: "doc", revision: 1, payload: {} }], total: 1, limit: 1, offset: 0, providerPayload: "x" })).toThrow();
    expect(() => HindsightFactPageSchema.parse({ items: [{ factId: "fact", documentId: "doc", revision: 1, payload: { text: "x".repeat(100_001) } }], total: 1, limit: 1, offset: 0 })).toThrow();
    expect(() => HindsightFactPageSchema.parse({ items: [{ factId: "fact", documentId: "doc", revision: 1, payload: { nested: { deeper: { value: { stillDeeper: { tooDeep: { leaf: "x" } } } } } } }], total: 1, limit: 1, offset: 0 })).toThrow();
  });

  it("binds snapshot identity, revisions, composed counts, and page hashes", () => {
    const lineage = "11111111-1111-4111-8111-111111111111";
    const generation = "22222222-2222-4222-8222-222222222222";
    expect(HindsightLogicalSnapshotRecordSchema.parse({
      objectKind: "memory_unit", objectId: "memory", objectRevision: 2,
      payload: { kind: "memory_unit", value: {
        memoryId: "memory", bankId: "bank", documentId: "document", chunkId: null, text: "safe memory",
        context: null, factType: "world", state: "valid", revision: 2, tags: [], metadata: {}, entities: [],
        sourceMemoryIds: [], observationScopes: null, eventDate: null, occurredStart: null, occurredEnd: null,
        mentionedAt: null, createdAt: now, updatedAt: now, editedAt: null, consolidatedAt: null,
        consolidationFailedAt: null, invalidationReason: null, invalidatedAt: null, proofCount: 1,
      } },
    })).toMatchObject({ objectRevision: 2 });
    expect(() => HindsightLogicalSnapshotRecordSchema.parse({
      objectKind: "memory_unit", objectId: "other", objectRevision: 1,
      payload: { kind: "document", value: { documentId: "document", bankId: "bank", contentHash: null, tags: [], metadata: {}, observationScopes: null, createdAt: now, updatedAt: now } },
    })).toThrow();
    const manifest = { schemaVersion: 1, bankId: "bank", providerLineage: lineage, bankGeneration: generation,
      endCursor: 3, pageSize: 2, totalPages: 1, totalRecords: 2,
      counts: { bank: 1, document: 0, memoryUnit: { valid: 1, invalidated: 0 }, mentalModel: 0, directive: 0, total: 2 },
      pageHashes: [hash], manifestDigest: hash };
    expect(HindsightLogicalSnapshotManifestSchema.parse(manifest)).toMatchObject({ endCursor: 3 });
    expect(() => HindsightLogicalSnapshotManifestSchema.parse({ ...manifest, totalPages: 2 })).toThrow();
  });
});
