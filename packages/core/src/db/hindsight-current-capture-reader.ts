/**
 * INPUT:  selected Local coverage and the writer-reserved Canonical database
 * OUTPUT: complete typed capture and independently hashed row dispositions
 * POS:    core/db — D78 read seam; blocks and Local policy remain evidence rather than facts
 */
import { HindsightCurrentCaptureSchema, type HindsightCurrentCapture, type HindsightCurrentDisposition,
  type HindsightLocalCoverageManifest, type HindsightLocalCoverageRecord } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { coverageHash, readHindsightLocalSource } from "./hindsight-local-coverage-reader.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import { restoreHindsightCurrentCaptureJson, requireHindsightCurrentCaptureJson } from "./hindsight-current-capture-json.ts";

const tables = {
  bank: ["canonical_memory_banks", "bank_id"], source: ["canonical_memory_sources", "document_id"],
  unit: ["canonical_memory_units", "memory_id"], policy: ["canonical_memory_policy", "memory_id"],
  lineage: ["canonical_memory_unit_sources", "memory_id"], derived: ["canonical_memory_derived", "object_id"],
} as const;

export function readHindsightCurrentCapture(db: Database, manifest: HindsightLocalCoverageManifest): HindsightCurrentCapture {
  const epochId = manifest.localEpochId; const memory = createCanonicalMemoryRepo(db);
  const banks = createCanonicalMemoryAuthorityRepo(db).listBanks(epochId).sort((a, b) => compare(a.bankId, b.bankId));
  const sources = manifest.records.filter((row) => row.kind === "source").map((row) =>
    readHindsightLocalSource(db, { epochId, bankId: String(row.bankId), documentId: row.objectId }));
  const records = manifest.records.filter((row) => row.kind === "unit").map((row) => {
    const record = memory.record(epochId, String(row.bankId), row.objectId);
    if (!record) throw new Error("HINDSIGHT_CURRENT_CAPTURE_INCOMPLETE");
    record.unit.sourceMemoryIds.sort(compare);
    return record;
  });
  const derived = manifest.records.filter((row) => row.kind === "derived").map((row) => {
    if (row.relatedId !== "mental_model" && row.relatedId !== "directive") throw new Error("HINDSIGHT_CURRENT_CAPTURE_INCOMPLETE");
    const value = memory.getDerived({ epochId, bankId: String(row.bankId), kind: row.relatedId, objectId: row.objectId });
    if (!value) throw new Error("HINDSIGHT_CURRENT_CAPTURE_INCOMPLETE");
    return value;
  });
  const body = restoreHindsightCurrentCaptureJson({ schemaVersion: 1, manifest, banks, sources, records, derived,
    dispositions: manifest.records.map((witness) => disposition(db, { epochId, witness })) });
  return HindsightCurrentCaptureSchema.parse({ ...body, captureId: currentCaptureHash(body) });
}

export function currentCaptureHash(value: Omit<HindsightCurrentCapture, "captureId">): string {
  return canonicalPayloadHash(["taki-current-local-capture.v1", value]);
}

export function assertHindsightCurrentCapture(raw: unknown): HindsightCurrentCapture {
  const value = HindsightCurrentCaptureSchema.parse(raw); const { captureId, ...body } = value;
  if (captureId !== currentCaptureHash(body)) throw new Error("HINDSIGHT_CURRENT_CAPTURE_CORRUPT");
  for (const item of value.dispositions) {
    if (coverageHash(item.witness.kind, JSON.parse(item.payloadJson)) !== item.witness.payloadHash) {
      throw new Error("HINDSIGHT_CURRENT_CAPTURE_CORRUPT");
    }
  }
  requireHindsightCurrentCaptureJson(body);
  return value;
}

function disposition(db: Database, input: { epochId: string; witness: HindsightLocalCoverageRecord }): HindsightCurrentDisposition {
  const { witness } = input; const raw = readRow(db, input);
  const payload = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key,
    key.endsWith("_json") && typeof value === "string" ? JSON.parse(value) as unknown : value]));
  if (coverageHash(witness.kind, payload) !== witness.payloadHash) throw new Error("HINDSIGHT_LOCAL_COVERAGE_STALE");
  const nativeKind = witness.kind === "source" ? "document" : witness.kind === "unit" || witness.kind === "lineage"
    ? "memory_unit" : witness.kind === "derived" && (witness.relatedId === "mental_model" || witness.relatedId === "directive")
      ? witness.relatedId : null;
  return { witness, destination: nativeKind === null ? "taki-artifact" : "native-object",
    nativeKind, nativeSourceId: nativeKind === null ? null : witness.objectId, payloadJson: canonicalJson(payload) };
}

function readRow(db: Database, input: { epochId: string; witness: HindsightLocalCoverageRecord }): SqlRow {
  const { epochId, witness } = input; let row: SqlRow | undefined;
  if (witness.kind === "epoch") {
    row = db.prepare(`SELECT e.*,s.updated_at AS authority_updated_at FROM canonical_memory_authority_state s
      JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1 AND e.epoch_id=:epoch`)
      .get({ epoch: epochId });
  } else if (witness.kind === "block") {
    row = db.prepare(`SELECT block_id,scope_kind,character_id,content,revision,updated_at FROM taki_memory_blocks
      WHERE block_id=:id`).get({ id: witness.objectId });
  } else if (witness.kind === "source-provenance") {
    row = db.prepare(`SELECT provenance_json FROM canonical_memory_sources
      WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:id`)
      .get({ epoch: epochId, bank: witness.bankId, id: witness.objectId });
  } else {
    const [table, identity] = tables[witness.kind];
    const related = witness.kind === "lineage" ? " AND source_memory_id=:related" : witness.kind === "derived" ? " AND kind=:related" : "";
    row = db.prepare(`SELECT * FROM ${table} WHERE authority_epoch_id=:epoch AND bank_id=:bank AND ${identity}=:id${related}`)
      .get({ epoch: epochId, bank: witness.bankId, id: witness.objectId, ...(related ? { related: witness.relatedId } : {}) });
  }
  if (!row) throw new Error("HINDSIGHT_CURRENT_CAPTURE_INCOMPLETE");
  return row;
}

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
