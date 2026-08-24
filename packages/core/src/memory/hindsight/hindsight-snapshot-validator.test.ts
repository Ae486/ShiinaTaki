import { describe, expect, it } from "vitest";
import type { HindsightLogicalSnapshotRecord } from "@taki/shared";
import { snapshotManifestHash, verifyLogicalSnapshot } from "./hindsight-snapshot-validator.ts";

const now = "2026-08-21T00:00:00.000Z";
const later = "2026-08-21T01:00:00.000Z";
const lineage = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const records: HindsightLogicalSnapshotRecord[] = [bank(), document(), memory()];
  const pageRecords = [records.slice(0, 2), records.slice(2)];
  const pageHashes = ["a".repeat(64), "b".repeat(64)];
  const metadata = {
    snapshotId,
    manifest: { schemaVersion: 1 as const, bankId: "bank", providerLineage: lineage, bankGeneration: generation,
      endCursor: 9, pageSize: 2, totalPages: 2, totalRecords: 3,
      counts: { bank: 1, document: 1, memoryUnit: { valid: 1, invalidated: 0 }, mentalModel: 0, directive: 0, total: 3 },
      pageHashes, manifestDigest: "a".repeat(64) }, createdAt: now, expiresAt: later,
  };
  metadata.manifest.manifestDigest = snapshotManifestHash(metadata);
  const pages = pageRecords.map((items, pageNumber) => ({ snapshotId, pageNumber, totalPages: 2,
    recordCount: items.length, contentHash: pageHashes[pageNumber] ?? "", records: items }));
  return { metadata, pages };
}

describe("Hindsight logical snapshot validator", () => {
  it("verifies page order, hashes, counts, aggregate manifest, lineage, and lifecycle", () => {
    const value = fixture();
    expect(verifyLogicalSnapshot({ ...value, expectedBankId: "bank", expectedProviderLineage: lineage, now })).toMatchObject({
      records: [{ objectKind: "bank" }, { objectKind: "document" }, { objectKind: "memory_unit", payload: { value: { state: "valid", revision: 4 } } }],
    });
  });

  it.each([
    ["page order", (value: ReturnType<typeof fixture>) => { value.pages.reverse(); }],
    ["page hash", (value: ReturnType<typeof fixture>) => { value.pages[0]!.contentHash = "c".repeat(64); }],
    ["record count", (value: ReturnType<typeof fixture>) => { value.metadata.manifest.counts.memoryUnit.valid = 0; value.metadata.manifest.counts.memoryUnit.invalidated = 1; value.metadata.manifest.manifestDigest = snapshotManifestHash(value.metadata); }],
    ["manifest hash", (value: ReturnType<typeof fixture>) => { value.metadata.manifest.manifestDigest = "b".repeat(64); }],
    ["expiry", (value: ReturnType<typeof fixture>) => {
      value.metadata.createdAt = "2026-08-20T22:00:00.000Z";
      value.metadata.expiresAt = "2026-08-20T23:00:00.000Z";
    }],
  ])("rejects %s mismatches", (_name, mutate) => {
    const value = fixture(); mutate(value);
    expect(() => verifyLogicalSnapshot({ ...value, expectedBankId: "bank", expectedProviderLineage: lineage, now })).toThrow(/HINDSIGHT_SNAPSHOT_/);
  });

  it("rejects missing pages and provider lineage drift", () => {
    const missing = fixture(); missing.pages.pop();
    expect(() => verifyLogicalSnapshot({ ...missing, expectedBankId: "bank", expectedProviderLineage: lineage, now })).toThrow(/PAGE_MISSING/);
    const drift = fixture();
    expect(() => verifyLogicalSnapshot({ ...drift, expectedBankId: "bank", expectedProviderLineage: generation, now })).toThrow(/LINEAGE_MISMATCH/);
  });
});

function bank(): HindsightLogicalSnapshotRecord {
  return { objectKind: "bank", objectId: "bank", objectRevision: 1, payload: { kind: "bank", value: {
    bankId: "bank", name: "Global", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember",
    config: {}, createdAt: now, updatedAt: now,
  } } };
}
function document(): HindsightLogicalSnapshotRecord {
  return { objectKind: "document", objectId: "document", objectRevision: 2, payload: { kind: "document", value: {
    documentId: "document", bankId: "bank", contentHash: "a".repeat(64), tags: [], metadata: {},
    observationScopes: null, createdAt: now, updatedAt: now,
  } } };
}
function memory(): HindsightLogicalSnapshotRecord {
  return { objectKind: "memory_unit", objectId: "fact", objectRevision: 4, payload: { kind: "memory_unit", value: {
    memoryId: "fact", bankId: "bank", documentId: "document", chunkId: null, text: "safe memory", context: null,
    factType: "world", state: "valid", revision: 4, tags: [], metadata: {}, entities: [], sourceMemoryIds: [],
    observationScopes: null, eventDate: null, occurredStart: null, occurredEnd: null, mentionedAt: null, createdAt: now,
    updatedAt: now, editedAt: null, consolidatedAt: null, consolidationFailedAt: null, invalidationReason: null,
    invalidatedAt: null, proofCount: 1,
  } } };
}
