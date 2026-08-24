/**
 * INPUT:  authenticated Hindsight logical-snapshot JSON pages and manifests
 * OUTPUT: bounded wire projections for the cursor-bound replication seam
 * POS:    core/memory/hindsight — provider boundary; no offset list is accepted as a replica feed
 */
import { z } from "zod";
import { HindsightLogicalSnapshotMetadataSchema, HindsightLogicalSnapshotPageSchema, type HindsightLogicalSnapshotManifest, type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage, type HindsightLogicalSnapshotRecord } from "@taki/shared";

const Id = z.string().min(1).max(512);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Timestamp = z.iso.datetime({ offset: true });
const JsonLeaf = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
function boundedJson(depth: number): z.ZodType<unknown> {
  if (depth === 0) return JsonLeaf;
  const item = boundedJson(depth - 1);
  return z.union([JsonLeaf, z.array(item).max(256),
    z.record(z.string().min(1).max(128), item).refine((value) => Object.keys(value).length <= 128)]);
}
const Payload = z.record(z.string().min(1).max(128), boundedJson(4)).refine((value) => Object.keys(value).length <= 128);

const WireManifestSchema = z.strictObject({
  schema_version: z.literal(1), bank_id: Id, provider_lineage: z.string().uuid(), bank_generation: z.string().uuid(),
  end_cursor: z.int().min(0), page_size: z.int().min(1).max(1000), total_pages: z.int().min(1),
  total_records: z.int().min(1), counts: z.strictObject({
    bank: z.int().min(0), document: z.int().min(0),
    memory_unit: z.strictObject({ valid: z.int().min(0), invalidated: z.int().min(0) }),
    mental_model: z.int().min(0), directive: z.int().min(0), total: z.int().min(1),
  }), page_hashes: z.array(Hash).min(1).max(100_000), sha256: Hash,
}).superRefine((value, context) => {
  if (value.total_records !== value.counts.total) context.addIssue({ code: "custom", message: "snapshot total mismatch" });
  if (value.page_hashes.length !== value.total_pages) context.addIssue({ code: "custom", message: "snapshot page hash mismatch" });
});

const WireRecordSchema = z.strictObject({
  object_kind: z.enum(["bank", "document", "memory_unit", "mental_model", "directive"]),
  object_id: Id, object_revision: z.int().min(1), payload: Payload,
});
export const HindsightSnapshotMetadataWireSchema = z.strictObject({
  snapshot_id: z.string().uuid(), manifest: WireManifestSchema, created_at: Timestamp, expires_at: Timestamp,
});
export const HindsightSnapshotPageWireSchema = z.strictObject({
  snapshot_id: z.string().uuid(), page_number: z.int().min(0), total_pages: z.int().min(1),
  record_count: z.int().min(1).max(1000), content_sha256: Hash, records: z.array(WireRecordSchema).min(1).max(1000),
}).superRefine((value, context) => {
  if (value.record_count !== value.records.length) context.addIssue({ code: "custom", message: "snapshot page count mismatch" });
});

export type HindsightSnapshotMetadataWire = z.infer<typeof HindsightSnapshotMetadataWireSchema>;
export type HindsightSnapshotPageWire = z.infer<typeof HindsightSnapshotPageWireSchema>;

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
    records: value.records.map(normalizeRecord),
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

function normalizeRecord(value: z.infer<typeof WireRecordSchema>): HindsightLogicalSnapshotRecord {
  const payload = toCamel(value.payload);
  return { objectKind: value.object_kind, objectId: value.object_id, objectRevision: value.object_revision,
    payload: { kind: value.object_kind, value: payload } } as HindsightLogicalSnapshotRecord;
}

function toCamel(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item]));
}
