/**
 * INPUT:  one expired activity record with an expected revision and captured Local scope
 * OUTPUT: atomic machine retention deletion, source cleanup, and persistent historical identity
 * POS:    core/db — the only internal hard-delete path; ordinary memories use reversible invalidation
 */
import { HindsightCurrentCanonicalSourceSchema, type CanonicalMemorySource } from "@taki/shared";
import { z } from "zod";
import type { CanonicalMaintenanceMutation, CanonicalMemoryMaintenanceRepo } from "./canonical-memory-maintenance-contract.ts";
import { CANONICAL_LOCAL_EVIDENCE_KEY, canonicalEvidenceTargets, readCanonicalEvidenceSources,
  type CanonicalEvidenceReference } from "./canonical-memory-maintenance-evidence.ts";
import { runCanonicalMaintenance, validateCanonicalMaintenanceMutation } from "./canonical-memory-maintenance-journal.ts";
import { ensureCanonicalMaintenanceSnapshot } from "./canonical-memory-maintenance-mutations.ts";
import { requireExpectedCanonicalRecord } from "./canonical-memory-maintenance-query.ts";
import { readCanonicalSource, removeCanonicalFts, upsertCanonicalSource } from "./canonical-memory-maintenance-records.ts";
import type { Database } from "./sqlite.ts";

const Id = z.string().min(1).max(256);
const Deleted = z.strictObject({ outcome: z.literal("deleted"), bankId: Id, memoryId: Id,
  deletedRevision: z.int().min(1), deletedAt: z.iso.datetime({ offset: true }) });
type DeletedResult = ReturnType<CanonicalMemoryMaintenanceRepo["hardDeleteRolling"]>;
const DAY_MS = 86_400_000;

export function hardDeleteCanonicalRollingMemory(db: Database, input: CanonicalMaintenanceMutation): DeletedResult {
  validateCanonicalMaintenanceMutation(db, input);
  return runCanonicalMaintenance(db, input, { kind: "hard-delete-rolling", apply: () => applyDeletion(db, input),
    encode: (value) => Deleted.parse(value), decode: (value) => Deleted.parse(value) });
}

function applyDeletion(db: Database, input: CanonicalMaintenanceMutation): DeletedResult {
  const record = requireExpectedCanonicalRecord(db, input);
  const { retention } = record.policy;
  // The registry's machine-only activity layer is the sole irreversible retention rule.
  // Merely assigning rolling-window retention to a relationship or profile grants no deletion right.
  if (record.policy.layerId !== "activity" || retention.kind !== "rolling-window"
    || Date.parse(input.now) - Date.parse(record.unit.updatedAt) <= retention.days * DAY_MS) {
    throw new Error("MEMORY_INVALID_REQUEST: rolling retention does not permit deletion");
  }
  const refs = db.prepare(`SELECT 1 FROM canonical_memory_unit_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND source_memory_id=:memory LIMIT 1`)
    .get({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId });
  if (refs) throw new Error("MEMORY_INVALID_REQUEST: memory still supports another fact");
  const sources = new Set(readCanonicalEvidenceSources(db, input).map((source) => source.documentId));
  if (record.unit.documentId !== null) sources.add(record.unit.documentId);
  ensureCanonicalMaintenanceSnapshot(db, record, input.now);
  removeCanonicalFts(db, input);
  db.prepare(`DELETE FROM canonical_memory_unit_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory`)
    .run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId });
  const removed = db.prepare(`DELETE FROM canonical_memory_units
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory AND revision=:revision`)
    .run({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId, revision: input.expectedRevision });
  if (Number(removed.changes) !== 1) throw new Error(`MEMORY_REVISION_MISMATCH:${record.unit.revision}`);
  for (const documentId of sources) cleanSource(db, input, documentId);
  return { outcome: "deleted", bankId: input.bankId, memoryId: input.memoryId,
    deletedRevision: record.unit.revision, deletedAt: input.now };
}

function cleanSource(db: Database, input: CanonicalMaintenanceMutation, documentId: string): void {
  const source = readCanonicalSource(db, { ...input, documentId });
  if (!source) throw new Error("MEMORY_INTEGRITY_ERROR: retention source missing");
  const targets = canonicalEvidenceTargets(source);
  const remaining = targets.filter((target) => target.epochId !== input.epochId
    || target.bankId !== input.bankId || target.memoryId !== input.memoryId);
  const direct = db.prepare(`SELECT 1 FROM canonical_memory_units
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc LIMIT 1`)
    .get({ epoch: input.epochId, bank: input.bankId, doc: documentId });
  if (!direct && !remaining.some((target) => evidenceTargetExists(db, target))) {
    retireSource(db, source, input.now); return;
  }
  if (remaining.length === targets.length) return;
  const updated = HindsightCurrentCanonicalSourceSchema.parse({ ...source, revision: source.revision + 1,
    updatedAt: input.now, metadata: { ...source.metadata,
      [CANONICAL_LOCAL_EVIDENCE_KEY]: { version: 1, targets: remaining } } });
  upsertCanonicalSource(db, updated, updated.revision);
}

function evidenceTargetExists(db: Database, target: CanonicalEvidenceReference): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM canonical_memory_units
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory`)
    .get({ epoch: target.epochId, bank: target.bankId, memory: target.memoryId }));
}

function retireSource(db: Database, source: CanonicalMemorySource, now: string): void {
  const removed = db.prepare(`DELETE FROM canonical_memory_sources
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND document_id=:doc AND revision=:revision`)
    .run({ epoch: source.authorityEpochId, bank: source.bankId, doc: source.documentId, revision: source.revision });
  if (Number(removed.changes) !== 1) throw new Error("MEMORY_INTEGRITY_ERROR: source changed during retention");
  db.prepare(`INSERT INTO canonical_memory_retired_sources
    (authority_epoch_id,bank_id,document_id,last_revision,deleted_at) VALUES (:epoch,:bank,:doc,:revision,:deleted)`)
    .run({ epoch: source.authorityEpochId, bank: source.bankId, doc: source.documentId,
      revision: source.revision, deleted: now });
}
