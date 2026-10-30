/**
 * INPUT:  authenticated Hindsight logical-snapshot JSON pages and manifests
 * OUTPUT: bounded wire projections for the cursor-bound replication seam
 * POS:    core/memory/hindsight — provider boundary; no offset list is accepted as a replica feed
 */
import { HindsightLogicalSnapshotMetadataSchema, HindsightLogicalSnapshotPageSchema, HindsightLogicalSnapshotRecordSchema,
  type HindsightSnapshotMetadataWire, type HindsightSnapshotPageWire, type HindsightSnapshotRecordWire,
  type HindsightLogicalSnapshotManifest, type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage,
  type HindsightLogicalSnapshotRecord } from "@taki/shared";
export { HindsightSnapshotMetadataWireSchema, HindsightSnapshotPageWireSchema } from "@taki/shared";
export type { HindsightSnapshotMetadataWire, HindsightSnapshotPageWire } from "@taki/shared";

export function normalizeSnapshotMetadata(value: HindsightSnapshotMetadataWire): HindsightLogicalSnapshotMetadata {
  return HindsightLogicalSnapshotMetadataSchema.parse({
    snapshotId: value.snapshot_id,
    manifest: normalizeManifest(value.manifest),
    createdAt: value.created_at,
    expiresAt: value.expires_at,
  });
}

export function normalizeSnapshotPage(value: HindsightSnapshotPageWire): HindsightLogicalSnapshotPage {
  return HindsightLogicalSnapshotPageSchema.parse({
    snapshotId: value.snapshot_id,
    pageNumber: value.page_number,
    totalPages: value.total_pages,
    recordCount: value.record_count,
    contentHash: value.content_sha256,
    records: value.records.map(normalizeHindsightLogicalRecord),
  });
}

function normalizeManifest(value: HindsightSnapshotMetadataWire["manifest"]): HindsightLogicalSnapshotManifest {
  return {
    schemaVersion: value.schema_version, bankId: value.bank_id, providerLineage: value.provider_lineage,
    bankGeneration: value.bank_generation, endCursor: value.end_cursor, pageSize: value.page_size,
    totalPages: value.total_pages, totalRecords: value.total_records,
    counts: { bank: value.counts.bank, document: value.counts.document, memoryUnit: value.counts.memory_unit,
      mentalModel: value.counts.mental_model, directive: value.counts.directive, total: value.counts.total },
    pageHashes: value.page_hashes, manifestDigest: value.sha256,
  };
}

export function normalizeHindsightLogicalRecord(value: HindsightSnapshotRecordWire): HindsightLogicalSnapshotRecord {
  const payload = toCamel(value.payload);
  return HindsightLogicalSnapshotRecordSchema.parse({ objectKind: value.object_kind, objectId: value.object_id, objectRevision: value.object_revision,
    payload: { kind: value.object_kind, value: payload } });
}

function toCamel(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item] as const);
  // Provider fields are normalized only at the top level; nested metadata/config keys are opaque.
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error("HINDSIGHT_RESPONSE_INVALID");
  return Object.fromEntries(entries);
}
