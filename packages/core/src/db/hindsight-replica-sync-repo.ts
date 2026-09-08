/**
 * INPUT:  cursor-bound snapshots, complete journal pages, captured Authority/Bank bindings, leases, and deadlines
 * OUTPUT: transaction-fenced atomic record/FTS/cache/checkpoint publication and durable full canonical reads
 * POS:    core/db — B5 single-writer replica; no writes to B4 activation receipts or Memory Authority
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MemoryReplicaBankSchema, MemoryReplicaCheckpointSchema, MemoryReplicaJournalPageSchema, type CanonicalMemoryRecord, type MemoryReplicaBank,
  type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage, type HindsightLogicalSnapshotRecord, type MemoryReplicaCheckpoint,
  type MemoryAuthorityEpoch, type MemoryReplicaJournalPage, type MemoryReplicaLease, type MemoryReplicaRecord,
} from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import type { SearchTokenizer } from "../memory/search-tokenizer.ts";
import { verifyLogicalSnapshot } from "../memory/hindsight/hindsight-snapshot-validator.ts";
import { projectHindsightReplicaRecord, type HindsightReplicaProjection } from "../memory/hindsight/hindsight-replica-projection.ts";
import { createReplicaRecordStore, type ReplicaRecordRead, type ReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import { createHindsightReplicaLeaseRepo, type HindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { readReplicaCheckpoint, publishReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { invalidateReplicaSnapshotCache, publishReplicaSnapshotCache, readReplicaSnapshotCache, type ReplicaSnapshotCacheKey } from "./hindsight-replica-snapshot-cache.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";

export interface ReplicaSnapshotInput {
  metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[];
  authorityEpochId: string; expectedProviderLineageId: string; expectedBankGeneration: string;
  expectedCheckpoint: MemoryReplicaCheckpoint | null; lease: MemoryReplicaLease;
  deadlineAt?: string; expectedBank?: MemoryReplicaBank;
  expectedAuthority?: Pick<MemoryAuthorityEpoch, "epochId" | "providerLineageId">;
}
export interface ReplicaApplyInput {
  page: MemoryReplicaJournalPage; expectedCheckpoint: MemoryReplicaCheckpoint; lease: MemoryReplicaLease;
  deadlineAt?: string; expectedBank?: MemoryReplicaBank;
  expectedAuthority?: Pick<MemoryAuthorityEpoch, "epochId" | "providerLineageId">;
}
export type ReplicaReconciliationInput = Omit<ReplicaSnapshotInput, "expectedCheckpoint"> & {
  expectedCheckpoint: MemoryReplicaCheckpoint; reset: boolean;
};
export interface HindsightReplicaSyncRepo {
  leases: HindsightReplicaLeaseRepo;
  seedVerifiedSnapshot(input: ReplicaSnapshotInput): MemoryReplicaCheckpoint;
  reconcileVerifiedSnapshot(input: ReplicaReconciliationInput): MemoryReplicaCheckpoint;
  cachedSnapshotRecord(input: ReplicaSnapshotCacheKey): HindsightLogicalSnapshotRecord | undefined;
  applyPage(input: ReplicaApplyInput): MemoryReplicaCheckpoint;
  checkpoint(bankId: string): MemoryReplicaCheckpoint | undefined;
  logicalRecord(input: ReplicaRecordRead): MemoryReplicaRecord | undefined;
  record(input: { bankId: string; memoryId: string; includeInvalidated?: boolean }): CanonicalMemoryRecord | undefined;
  search(input: { bankId: string; query: string; limit: number }): CanonicalMemoryRecord[];
}
interface State { db: Database; records: ReplicaRecordStore; leases: HindsightReplicaLeaseRepo; projection: HindsightReplicaProjection; now: () => string }

export function createHindsightReplicaSyncRepo(input: {
  db: Database; tokenizer: SearchTokenizer; projection: HindsightReplicaProjection; now?: () => string;
}): HindsightReplicaSyncRepo {
  const now = () => z.iso.datetime({ offset: true }).parse(input.now?.() ?? new Date().toISOString());
  const state: State = { ...input, now, records: createReplicaRecordStore(input.db, input.tokenizer),
    leases: createHindsightReplicaLeaseRepo(input.db, now) };
  return {
    leases: state.leases, seedVerifiedSnapshot: (value) => seed(state, value), applyPage: (value) => apply(state, value),
    reconcileVerifiedSnapshot: (value) => seed(state, value, value.reset ? "reset" : "reconcile"),
    cachedSnapshotRecord: (key) => readReplicaSnapshotCache(input.db, key),
    checkpoint: (bankId) => readReplicaCheckpoint(input.db, bankId), logicalRecord: state.records.get,
    record: (value) => {
      const record = state.records.get({ ...value, objectKind: "memory_unit", objectId: value.memoryId });
      return record?.payload?.kind === "memory_unit" ? record.payload.value : undefined;
    },
    search: state.records.search,
  };
}

function seed(state: State, input: ReplicaSnapshotInput, mode: "seed" | "reconcile" | "reset" = "seed"): MemoryReplicaCheckpoint {
  state.leases.assert(input.lease);
  const snapshot = verifyLogicalSnapshot({ ...input, expectedBankId: input.lease.bankId,
    expectedProviderLineage: input.expectedProviderLineageId, now: state.now() });
  if (snapshot.metadata.manifest.bankGeneration !== input.expectedBankGeneration) throw new Error("HINDSIGHT_REPLICA_GENERATION_MISMATCH");
  const records = snapshot.records.map((record) => projectHindsightReplicaRecord(record, {
    bankId: input.lease.bankId, authorityEpochId: input.authorityEpochId, projection: state.projection,
  }));
  assertSnapshotRecords(records, input.lease.bankId);
  assertBankBinding(input.lease.bankId, input.expectedBank, records);
  let result: MemoryReplicaCheckpoint | undefined;
  state.db.transaction(() => {
    state.leases.assert(input.lease);
    assertPublicationBinding(state, input);
    assertSnapshotFresh(state.now(), input);
    const previous = requireExpected(state, input.lease.bankId, input.expectedCheckpoint);
    if (mode !== "seed" && !previous) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
    if (previous && previous.authorityEpochId !== input.authorityEpochId) throw new Error("HINDSIGHT_REPLICA_EPOCH_MISMATCH");
    if (mode !== "reset") assertSnapshotPredecessor(previous, input);
    if (mode === "seed") {
      state.records.clear(input.lease.bankId);
      for (const record of records) state.records.write(record, null);
    } else state.records.reconcile(input.lease.bankId, records);
    const manifest = snapshot.metadata.manifest;
    result = MemoryReplicaCheckpointSchema.parse({ bankId: manifest.bankId, providerLineageId: manifest.providerLineage,
      bankGeneration: manifest.bankGeneration, authorityEpochId: input.authorityEpochId, replicaEpochId: randomUUID(),
      endCursor: manifest.endCursor, snapshotId: snapshot.metadata.snapshotId, snapshotCursor: manifest.endCursor,
      snapshotManifestDigest: manifest.manifestDigest, manifestDigest: state.records.digest(manifest.bankId), verifiedAt: state.now() });
    publishReplicaSnapshotCache(state.db, snapshot);
    assertSnapshotFresh(state.now(), input);
    state.leases.assert(input.lease);
    assertPublicationBinding(state, input);
    publishReplicaCheckpoint(state.db, { previous, next: result });
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_APPLY_FAILED");
  return result;
}

function assertSnapshotFresh(now: string, input: ReplicaSnapshotInput): void {
  if (Date.parse(input.metadata.expiresAt) <= Date.parse(now)) throw new Error("HINDSIGHT_SNAPSHOT_EXPIRED");
  assertRunDeadline(now, input.deadlineAt);
}

function assertRunDeadline(now: string, deadlineAt?: string): void {
  if (deadlineAt !== undefined && Date.parse(z.iso.datetime({ offset: true }).parse(deadlineAt)) <= Date.parse(now)) {
    throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  }
}

function apply(state: State, input: ReplicaApplyInput): MemoryReplicaCheckpoint {
  const page = MemoryReplicaJournalPageSchema.parse(input.page);
  const expected = MemoryReplicaCheckpointSchema.parse(input.expectedCheckpoint);
  assertBankBinding(page.bankId, input.expectedBank, page.records);
  for (const record of page.records) assertRecordEpoch(record, expected.authorityEpochId);
  let result: MemoryReplicaCheckpoint | undefined;
  state.db.transaction(() => {
    state.leases.assert(input.lease);
    assertPublicationBinding(state, input);
    assertRunDeadline(state.now(), input.deadlineAt);
    if (input.lease.bankId !== page.bankId) throw new Error("HINDSIGHT_REPLICA_LEASE_LOST");
    const previous = requireExpected(state, page.bankId, expected);
    if (!previous) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
    if (page.providerLineageId !== previous.providerLineageId) throw new Error("HINDSIGHT_REPLICA_LINEAGE_MISMATCH");
    if (page.bankGeneration !== previous.bankGeneration) throw new Error("HINDSIGHT_REPLICA_GENERATION_MISMATCH");
    if (page.predecessorCursor !== previous.endCursor) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
    for (const record of page.records) {
      state.records.write({ bankId: record.bankId, objectKind: record.objectKind,
        objectId: record.objectId, objectRevision: record.objectRevision, operation: record.operation, payload: record.payload }, record.cursor);
      invalidateReplicaSnapshotCache(state.db, record);
    }
    result = MemoryReplicaCheckpointSchema.parse({ ...previous, endCursor: page.nextCursor,
      manifestDigest: state.records.digest(page.bankId), verifiedAt: state.now() });
    assertRunDeadline(state.now(), input.deadlineAt);
    state.leases.assert(input.lease);
    assertPublicationBinding(state, input);
    publishReplicaCheckpoint(state.db, { previous, next: result });
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_APPLY_FAILED");
  return result;
}

function requireExpected(state: State, bankId: string, raw: MemoryReplicaCheckpoint | null): MemoryReplicaCheckpoint | null {
  const expected = raw === null ? null : MemoryReplicaCheckpointSchema.parse(raw);
  const current = readReplicaCheckpoint(state.db, bankId) ?? null;
  if (canonicalJson(current) !== canonicalJson(expected)) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
  return current;
}

function assertSnapshotPredecessor(previous: MemoryReplicaCheckpoint | null, input: ReplicaSnapshotInput): void {
  if (!previous) return;
  if (previous.providerLineageId !== input.expectedProviderLineageId || previous.bankGeneration !== input.expectedBankGeneration
    || previous.authorityEpochId !== input.authorityEpochId || previous.endCursor > input.metadata.manifest.endCursor) {
    throw new Error("HINDSIGHT_CHECKPOINT_STALE");
  }
}

function assertRecordEpoch(record: MemoryReplicaRecord, expected: string): void {
  if (!record.payload) return;
  const value = record.payload;
  const epoch = value.kind === "memory_unit" ? value.value.unit.authorityEpochId : value.value.authorityEpochId;
  if (epoch !== expected) throw new Error("HINDSIGHT_REPLICA_EPOCH_MISMATCH");
}

function assertSnapshotRecords(records: MemoryReplicaRecord[], bankId: string): void {
  const keys = records.map((record) => `${record.objectKind}\0${record.objectId}`);
  if (new Set(keys).size !== keys.length || records.filter((record) => record.objectKind === "bank" && record.objectId === bankId).length !== 1) {
    throw new Error("HINDSIGHT_REPLICA_INTEGRITY_ERROR");
  }
}

function assertBankBinding(bankId: string, expectedBank: MemoryReplicaBank | undefined, records: MemoryReplicaRecord[]): void {
  if (expectedBank === undefined) return;
  const expected = MemoryReplicaBankSchema.parse(expectedBank);
  if (expected.bankId !== bankId || records.some((record) => record.payload?.kind === "bank"
    && (record.payload.value.scope.kind !== expected.scope || record.payload.value.scope.characterId !== expected.characterId))) {
    throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  }
}

function assertPublicationBinding(state: State, input: Pick<ReplicaApplyInput, "expectedAuthority" | "expectedBank">): void {
  // A valid old checkpoint/lease does not prove that its Authority or trusted scope is still selected after HTTP work.
  if (input.expectedAuthority) {
    const current = createCanonicalMemoryAuthorityRepo(state.db).authorityEpoch();
    if (current.providerId !== "hindsight" || current.epochId !== input.expectedAuthority.epochId
      || current.providerLineageId !== input.expectedAuthority.providerLineageId) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  }
  if (input.expectedBank) {
    const expected = MemoryReplicaBankSchema.parse(input.expectedBank);
    const current = state.projection.bankScope(expected.bankId);
    // Most journal pages contain no Bank row, so checking only the projected page cannot detect scope rebinding.
    if (current.kind !== expected.scope || current.characterId !== expected.characterId) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  }
}
