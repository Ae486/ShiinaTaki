/**
 * INPUT:  a revision-bound canonical fact and an authorized destination Bank/policy
 * OUTPUT: atomic identity-preserving source/support copies and reversible retirement of the original
 * POS:    core/db — Local copy primitive; callers may compose a correction in the same synchronous transaction
 */
import {
  HindsightCurrentCanonicalRecordSchema, HindsightCurrentCanonicalSourceSchema,
  TakiMemoryPolicyProjectionSchema, type CanonicalMemoryRecord, type CanonicalMemorySource,
} from "@taki/shared";
import { z } from "zod";
import type { CanonicalMaintenanceCopyInput, CanonicalMaintenanceCopyResult } from "./canonical-memory-maintenance-contract.ts";
import { readCanonicalEvidenceSources, remapCanonicalSourceEvidence } from "./canonical-memory-maintenance-evidence.ts";
import { decodeCanonicalMaintenanceMutation, encodeCanonicalMaintenanceMutation,
  runCanonicalMaintenance, validateCanonicalMaintenanceMutation } from "./canonical-memory-maintenance-journal.ts";
import { canonicalMaintenanceSearchTerms, ensureCanonicalMaintenanceSnapshot,
  type CanonicalMaintenanceWriter } from "./canonical-memory-maintenance-mutations.ts";
import { requireExpectedCanonicalRecord } from "./canonical-memory-maintenance-query.ts";
import {
  addCanonicalLineage, canonicalControlledLayerTags, insertCanonicalUnitAndPolicy,
  readCanonicalSource, replaceCanonicalFts, requireCanonicalRecord, upsertCanonicalSource,
} from "./canonical-memory-maintenance-records.ts";
import { saveCanonicalSnapshot } from "./canonical-memory-maintenance-storage.ts";
import { createCanonicalMemoryRepo, stableRequestHash } from "./canonical-memory-repo.ts";
import type { Database } from "./sqlite.ts";

const Id = z.string().min(1).max(256);
const DestinationPolicy = TakiMemoryPolicyProjectionSchema.pick({ layerId: true, visibility: true, retention: true });
const MemoryMapping = z.strictObject({ sourceMemoryId: Id, memoryId: Id });
const SourceMapping = z.strictObject({ sourceDocumentId: Id, documentId: Id });
const CopyReceipt = z.strictObject({ record: z.unknown(), original: z.unknown(),
  memoryMappings: z.array(MemoryMapping), sourceMappings: z.array(SourceMapping) });

interface CopyPlan {
  originals: Map<string, CanonicalMemoryRecord>;
  sources: Map<string, CanonicalMemorySource>;
  memories: Map<string, string>;
  documents: Map<string, string>;
  crossBank: boolean;
}

export function copyCanonicalMemoryToBank(writer: CanonicalMaintenanceWriter, input: CanonicalMaintenanceCopyInput): CanonicalMaintenanceCopyResult {
  validateCanonicalMaintenanceMutation(writer.db, input);
  if (!DestinationPolicy.safeParse(input.policy).success) throw new Error("MEMORY_INVALID_REQUEST");
  return runCanonicalMaintenance(writer.db, input, { kind: "copy-to-bank", apply: () => applyCopy(writer, input),
    additionalScopes: [{ ...input, bankId: input.destinationBankId }],
    encode: (result) => ({ record: encodeCanonicalMaintenanceMutation({ outcome: "applied", record: result.record }),
      original: encodeCanonicalMaintenanceMutation({ outcome: "applied", record: result.original }),
      memoryMappings: result.memoryMappings, sourceMappings: result.sourceMappings }),
    decode: (value) => decodeCopy(writer.db, input, value) });
}

function applyCopy(writer: CanonicalMaintenanceWriter, input: CanonicalMaintenanceCopyInput): CanonicalMaintenanceCopyResult {
  const original = requireExpectedCanonicalRecord(writer.db, input);
  const plan = readCopyPlan(writer.db, input, original);
  const copies = [...plan.originals.values()].map((record) => cloneRecord(record, input, plan));
  insertCopiedSources(writer.db, input, plan);
  for (const record of copies) insertCanonicalUnitAndPolicy(writer.db, { unit: record.unit,
    policy: record.policy, searchTerms: canonicalMaintenanceSearchTerms(writer.tokenizer, record) });
  for (const record of copies) for (const sourceMemoryId of record.unit.sourceMemoryIds) {
    addCanonicalLineage(writer.db, { epochId: input.epochId, bankId: input.destinationBankId,
      memoryId: record.unit.memoryId, sourceMemoryId });
  }
  for (const copy of copies) {
    const stored = requireCanonicalRecord(writer.db, { ...input, bankId: input.destinationBankId, memoryId: copy.unit.memoryId });
    replaceCanonicalFts(writer.db, stored.unit, canonicalMaintenanceSearchTerms(writer.tokenizer, stored));
    saveCanonicalSnapshot(writer.db, stored, input.now);
  }
  ensureCanonicalMaintenanceSnapshot(writer.db, original, input.now);
  const invalidated = createCanonicalMemoryRepo(writer.db).invalidate({ ...input,
    requestId: copyIdentity(input, "retire", input.memoryId),
    requestHash: stableRequestHash(["canonical-copy-retirement.v1", input]),
    reason: plan.crossBank ? "refiled" : "superseded",
    searchTerms: canonicalMaintenanceSearchTerms(writer.tokenizer, original) });
  const memoryId = requireMapped(plan.memories, input.memoryId);
  return { outcome: "applied", record: requireCanonicalRecord(writer.db,
    { ...input, bankId: input.destinationBankId, memoryId }), original: invalidated.record,
    memoryMappings: [...plan.memories].map(([sourceMemoryId, memoryId]) => ({ sourceMemoryId, memoryId })),
    sourceMappings: [...plan.documents].map(([sourceDocumentId, documentId]) => ({ sourceDocumentId, documentId })) };
}

function readCopyPlan(db: Database, input: CanonicalMaintenanceCopyInput, original: CanonicalMemoryRecord): CopyPlan {
  const crossBank = input.destinationBankId !== input.bankId;
  const originals = new Map<string, CanonicalMemoryRecord>([[input.memoryId, original]]);
  const queue = [input.memoryId];
  for (const queuedId of queue) {
    if (!crossBank) break;
    const record = originals.get(queuedId);
    if (!record) throw new Error("MEMORY_INTEGRITY_ERROR: support graph changed");
    for (const memoryId of record.unit.sourceMemoryIds) {
      if (originals.has(memoryId)) continue;
      originals.set(memoryId, requireCanonicalRecord(db, { ...input, memoryId })); queue.push(memoryId);
    }
  }
  const sources = new Map<string, CanonicalMemorySource>();
  for (const record of originals.values()) {
    if (crossBank && record.unit.documentId !== null) {
      const source = readCanonicalSource(db, { ...input, documentId: record.unit.documentId });
      if (!source) throw new Error("MEMORY_INTEGRITY_ERROR: support source missing");
      sources.set(source.documentId, source);
    }
    for (const source of readCanonicalEvidenceSources(db, { ...input, memoryId: record.unit.memoryId })) {
      sources.set(source.documentId, source);
    }
  }
  const memories = new Map([...originals.keys()].sort().map((id) => [id, copyIdentity(input, "memory", id)]));
  const documents = new Map([...sources.keys()].sort().map((id) => [id, copyIdentity(input, "source", id)]));
  return { originals, sources, memories, documents, crossBank };
}

function cloneRecord(record: CanonicalMemoryRecord, input: CanonicalMaintenanceCopyInput, plan: CopyPlan): CanonicalMemoryRecord {
  const selected = record.unit.memoryId === input.memoryId;
  const memoryId = requireMapped(plan.memories, record.unit.memoryId);
  const documentId = plan.crossBank && record.unit.documentId !== null
    ? requireMapped(plan.documents, record.unit.documentId) : record.unit.documentId;
  const sourceMemoryIds = plan.crossBank ? record.unit.sourceMemoryIds.map((id) => requireMapped(plan.memories, id))
    : record.unit.sourceMemoryIds;
  const policy = { ...record.policy, bankId: input.destinationBankId, memoryId,
    ...(selected ? { ...input.policy, updatedAt: input.now }
      : plan.crossBank ? { visibility: "hidden" as const, updatedAt: input.now } : {}) };
  // Moving the selected fact does not authorize sharing every supporting fact.
  // Keep the complete copied graph as hidden evidence; only the selected node
  // receives the caller's destination policy. The original graph is unchanged.
  // New identity does not invent a new event, mention, proof, or provider derivation.
  // Those logical fields and opaque metadata remain the original evidence.
  const unit = { ...record.unit, bankId: input.destinationBankId, memoryId, documentId,
    sourceMemoryIds, revision: 1,
    tags: selected ? canonicalControlledLayerTags(record.unit.tags, policy.layerId) : record.unit.tags };
  return HindsightCurrentCanonicalRecordSchema.parse({ ...record, unit, policy });
}

function insertCopiedSources(db: Database, input: CanonicalMaintenanceCopyInput, plan: CopyPlan): void {
  for (const original of plan.sources.values()) {
    const documentId = requireMapped(plan.documents, original.documentId);
    if (readCanonicalSource(db, { ...input, bankId: input.destinationBankId, documentId })) {
      throw new Error("MEMORY_REQUEST_ID_CONFLICT");
    }
    const mapped = remapCanonicalSourceEvidence(original, { sourceBankId: input.bankId,
      destinationBankId: input.destinationBankId, memories: plan.memories });
    const source = HindsightCurrentCanonicalSourceSchema.parse({ ...mapped,
      bankId: input.destinationBankId, documentId, revision: 1 });
    upsertCanonicalSource(db, source, source.revision);
  }
}

function copyIdentity(input: CanonicalMaintenanceCopyInput, kind: string, originalId: string): string {
  return `local-copy-${stableRequestHash(["canonical-local-copy.v1", input.epochId,
    input.bankId, input.destinationBankId, input.requestId, kind, originalId])}`;
}

function requireMapped(mapping: ReadonlyMap<string, string>, id: string): string {
  const mapped = mapping.get(id);
  if (!mapped) throw new Error("MEMORY_INTEGRITY_ERROR: incomplete copy mapping");
  return mapped;
}

function decodeCopy(db: Database, input: CanonicalMaintenanceCopyInput, value: unknown): CanonicalMaintenanceCopyResult {
  const stored = CopyReceipt.parse(value);
  const copied = { epochId: input.epochId, bankId: input.destinationBankId, memoryId: copyIdentity(input, "memory", input.memoryId) };
  return { outcome: "applied", record: decodeCanonicalMaintenanceMutation(db, copied, stored.record).record,
    original: decodeCanonicalMaintenanceMutation(db, input, stored.original).record,
    memoryMappings: stored.memoryMappings, sourceMappings: stored.sourceMappings };
}
