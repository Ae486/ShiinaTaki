/**
 * INPUT:  one approved original source, extracted facts, and revision-bound lexical duplicate matches
 * OUTPUT: one atomic source/fact/evidence batch and a replayable factual receipt
 * POS:    core/db — Local ingestion storage only; gate and model decisions stay in the ingestion service
 */
import {
  HindsightCurrentCanonicalRecordSchema, HindsightCurrentCanonicalSourceSchema,
  HindsightCurrentCanonicalUnitSchema, TakiMemoryPolicyProjectionSchema,
} from "@taki/shared";
import { z } from "zod";
import type { CanonicalMaintenanceIngestInput, CanonicalMaintenanceIngestResult,
  CanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-contract.ts";
import { annotateCanonicalIngestionSource } from "./canonical-memory-maintenance-evidence.ts";
import { readCanonicalMaintenanceReceipt, runCanonicalMaintenance } from "./canonical-memory-maintenance-journal.ts";
import { applyCanonicalReinforcement, canonicalMaintenanceSearchTerms,
  type CanonicalMaintenanceWriter } from "./canonical-memory-maintenance-mutations.ts";
import { requireExpectedCanonicalRecord } from "./canonical-memory-maintenance-query.ts";
import {
  addCanonicalLineage, insertCanonicalUnitAndPolicy, readCanonicalSource, replaceCanonicalFts,
  requireCanonicalRecord, upsertCanonicalSource,
} from "./canonical-memory-maintenance-records.ts";
import { saveCanonicalSnapshot } from "./canonical-memory-maintenance-storage.ts";

const Id = z.string().min(1).max(256);
const Reference = z.strictObject({ memoryId: Id, revision: z.int().min(1) });
const IngestResult = z.strictObject({ documentId: Id, sourceRevision: z.int().min(1),
  memories: z.array(Reference).max(256), reinforced: z.array(Reference).max(256) });
const IngestInput = z.strictObject({ epochId: Id, bankId: Id, characterId: Id.nullable(), requestId: Id,
  now: z.iso.datetime({ offset: true }), source: HindsightCurrentCanonicalSourceSchema,
  units: z.array(z.strictObject({ unit: HindsightCurrentCanonicalUnitSchema,
    policy: TakiMemoryPolicyProjectionSchema, searchTerms: z.string() })).max(256),
  duplicates: z.array(z.strictObject({ memoryId: Id, expectedRevision: z.int().min(1),
    importance: TakiMemoryPolicyProjectionSchema.shape.importance })).max(256) });

export function createCanonicalMaintenanceIngestion(writer: CanonicalMaintenanceWriter): Pick<CanonicalMemoryMaintenanceRepo,
  "ingest" | "ingestReceipt"> {
  return {
    ingest(raw) {
      const input = parseInput(raw);
      return runCanonicalMaintenance(writer.db, input, { kind: "ingest", apply: () => applyIngestion(writer, input),
        encode: (value) => IngestResult.parse(value), decode: (value) => IngestResult.parse(value) });
    },
    ingestReceipt(raw) {
      const input = parseInput(raw);
      return readCanonicalMaintenanceReceipt(writer.db, input, { kind: "ingest", decode: (value) => IngestResult.parse(value) });
    },
  };
}

function parseInput(raw: CanonicalMaintenanceIngestInput): CanonicalMaintenanceIngestInput {
  const parsed = IngestInput.safeParse(raw);
  if (!parsed.success) throw new Error("MEMORY_INVALID_REQUEST");
  const input = parsed.data; const { source } = input;
  if (source.authorityEpochId !== input.epochId || source.bankId !== input.bankId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const identities = [...input.units.map((item) => item.unit.memoryId), ...input.duplicates.map((item) => item.memoryId)];
  if (new Set(identities).size !== identities.length) throw new Error("MEMORY_INVALID_REQUEST: duplicate batch target");
  for (const { unit, policy } of input.units) {
    if (unit.authorityEpochId !== input.epochId || unit.bankId !== input.bankId || unit.documentId !== source.documentId) {
      throw new Error("MEMORY_AUTHORITY_MISMATCH");
    }
    HindsightCurrentCanonicalRecordSchema.parse({ unit, policy, provenance: source.provenance });
  }
  return input;
}

function applyIngestion(writer: CanonicalMaintenanceWriter, input: CanonicalMaintenanceIngestInput): CanonicalMaintenanceIngestResult {
  if (readCanonicalSource(writer.db, { ...input, documentId: input.source.documentId })) {
    // A new request cannot reinterpret an already-retained source or replace its earlier facts.
    throw new Error("MEMORY_REQUEST_ID_CONFLICT");
  }
  for (const duplicate of input.duplicates) {
    const record = requireExpectedCanonicalRecord(writer.db, { ...input, ...duplicate });
    if (record.unit.state !== "valid") throw new Error("MEMORY_INVALID_REQUEST: duplicate target is invalidated");
  }
  const source = annotateCanonicalIngestionSource(input.source, input.duplicates.map((duplicate) => ({
    epochId: input.epochId, bankId: input.bankId, memoryId: duplicate.memoryId,
  })));
  upsertCanonicalSource(writer.db, source, source.revision);
  for (const item of input.units) insertCanonicalUnitAndPolicy(writer.db, item);
  for (const { unit } of input.units) for (const sourceMemoryId of unit.sourceMemoryIds) {
    addCanonicalLineage(writer.db, { epochId: input.epochId, bankId: input.bankId, memoryId: unit.memoryId, sourceMemoryId });
  }
  const memories = input.units.map(({ unit }) => {
    const record = requireCanonicalRecord(writer.db, { ...input, memoryId: unit.memoryId });
    replaceCanonicalFts(writer.db, record.unit, canonicalMaintenanceSearchTerms(writer.tokenizer, record));
    saveCanonicalSnapshot(writer.db, record, input.now);
    return { memoryId: unit.memoryId, revision: unit.revision };
  });
  const reinforced = input.duplicates.map((duplicate) => {
    const { record } = applyCanonicalReinforcement(writer, { ...input, ...duplicate, mode: "duplicate-write" });
    return { memoryId: record.unit.memoryId, revision: record.unit.revision };
  });
  return { documentId: source.documentId, sourceRevision: source.revision, memories, reinforced };
}
