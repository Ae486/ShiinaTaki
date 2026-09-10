/**
 * INPUT:  authenticated native logical snapshot JSON, including structured D78 metadata
 * OUTPUT: strict native snapshot envelopes and recursively bounded JSON payloads
 * POS:    shared provider wire — old snapshot encoding stays intact; transport bounds total bytes
 */
import { z } from "zod";
import { createHindsightJsonSchemas } from "./hindsight-json-schema.ts";

const logicalJson = createHindsightJsonSchemas(100_000);
export const HindsightLogicalJsonSchema = logicalJson.value;
export const HindsightLogicalJsonObjectSchema = logicalJson.object;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().min(1).max(512);
const Count = z.int().min(0);
const Timestamp = z.iso.datetime({ offset: true });
export const HindsightSnapshotManifestWireSchema = z.strictObject({
  schema_version: z.literal(1), bank_id: Id, provider_lineage: z.uuid(), bank_generation: z.uuid(),
  end_cursor: Count, page_size: z.int().min(1).max(1000), total_pages: z.int().min(1), total_records: z.int().min(1),
  counts: z.strictObject({ bank: Count, document: Count, memory_unit: z.strictObject({ valid: Count, invalidated: Count }),
    mental_model: Count, directive: Count, total: z.int().min(1) }),
  page_hashes: z.array(Hash).min(1).max(100_000), sha256: Hash,
}).superRefine((value, context) => {
  if (value.total_records !== value.counts.total || value.page_hashes.length !== value.total_pages) {
    context.addIssue({ code: "custom", message: "snapshot composition mismatch" });
  }
});
export const HindsightSnapshotRecordWireSchema = z.strictObject({
  object_kind: z.enum(["bank", "document", "memory_unit", "mental_model", "directive"]),
  object_id: Id, object_revision: z.int().min(1), payload: HindsightLogicalJsonObjectSchema,
});
export const HindsightSnapshotMetadataWireSchema = z.strictObject({
  snapshot_id: z.uuid(), manifest: HindsightSnapshotManifestWireSchema, created_at: Timestamp, expires_at: Timestamp,
});
export const HindsightSnapshotPageWireSchema = z.strictObject({
  snapshot_id: z.uuid(), page_number: Count, total_pages: z.int().min(1), record_count: z.int().min(1).max(1000),
  content_sha256: Hash, records: z.array(HindsightSnapshotRecordWireSchema).min(1).max(1000),
}).superRefine((value, context) => {
  if (value.record_count !== value.records.length) context.addIssue({ code: "custom", message: "snapshot page count mismatch" });
});
export type HindsightSnapshotMetadataWire = z.infer<typeof HindsightSnapshotMetadataWireSchema>;
export type HindsightSnapshotPageWire = z.infer<typeof HindsightSnapshotPageWireSchema>;
export type HindsightSnapshotRecordWire = z.infer<typeof HindsightSnapshotRecordWireSchema>;
