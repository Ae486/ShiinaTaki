/**
 * INPUT:  expected app/native checkpoint pairs, current Hindsight authority and captured Bank/lease/deadline
 * OUTPUT: transaction-local publication guards and checkpoint-last paired CAS
 * POS:    core/db — D77 checkpoint identity never reuses an application snapshot as a native V1 baseline
 */
import { randomUUID } from "node:crypto";
import { MemoryBankScopeSchema, MemoryReplicaBankSchema, MemoryReplicaCheckpointSchema, TakiApplicationTimeSchema,
  type MemoryBankScope, type MemoryReplicaCheckpoint } from "@taki/shared";
import { hindsightApplicationHash, sameApplicationValue, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { readReplicaCheckpoint, publishReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { HindsightApplicationReplicaCheckpointSchema, type HindsightApplicationReplicaCheckpoint,
  type HindsightApplicationReplicaState, type HindsightApplicationPublicationInput,
  type HindsightApplicationSnapshotInput, type HindsightApplicationEventInput } from "./hindsight-application-replica-contract.ts";
import type { Database } from "./sqlite.ts";

export function applicationCheckpointHash(value: HindsightApplicationReplicaCheckpoint): string {
  return hindsightApplicationHash({ namespace: value.namespace, bankId: value.bankId, domain: "record",
    value: { checkpoint_contract: "taki-application-replica-checkpoint.v1", checkpoint: value } });
}

export function readApplicationCheckpoint(db: Database, bankId: string): HindsightApplicationReplicaCheckpoint | undefined {
  const row = db.prepare("SELECT * FROM hindsight_application_replica_checkpoints WHERE bank_id=:bank").get({ bank: bankId });
  if (!row) return undefined;
  const value = HindsightApplicationReplicaCheckpointSchema.parse(JSON.parse(String(row.checkpoint_json)));
  if (value.bankId !== row.bank_id || value.namespace.provider_lineage !== row.provider_lineage
    || value.namespace.bank_generation !== row.bank_generation || value.namespace.application_id !== row.application_id
    || value.authorityEpochId !== row.authority_epoch_id || value.checkpoint.native_cursor !== row.native_cursor
    || value.checkpoint.state_cursor !== row.state_cursor || value.bankDeleted !== (row.bank_deleted === 1)
    || applicationCheckpointHash(value) !== row.checkpoint_hash) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_INVALID");
  return value;
}

export function assertApplicationPublication(state: HindsightApplicationReplicaState, input: HindsightApplicationPublicationInput): void {
  state.leases.assert(input.lease);
  assertApplicationAuthority(state, { ...input, bankScope: bankScope(input) });
  if (input.lease.bankId !== input.bankId) throw new Error("HINDSIGHT_REPLICA_LEASE_LOST");
  if (Date.parse(TakiApplicationTimeSchema.parse(input.deadlineAt)) <= Date.parse(state.now())) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  const current = readApplicationCheckpoint(state.db, input.bankId) ?? null;
  const native = readReplicaCheckpoint(state.db, input.bankId) ?? null;
  if (!sameApplicationValue(current, input.expectedCheckpoint) || !sameApplicationValue(native, input.expectedNativeCheckpoint)) {
    throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_STALE");
  }
}

export function assertApplicationAuthority(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & {
  authorityEpochId: string; bankScope: MemoryBankScope;
}): void {
  const authority = createCanonicalMemoryAuthorityRepo(state.db).authorityEpoch();
  if (authority.providerId !== "hindsight" || authority.epochId !== input.authorityEpochId
    || authority.providerLineageId !== input.namespace.provider_lineage) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  const current = MemoryBankScopeSchema.safeParse(state.bankScope(input.bankId));
  if (!current.success || !sameApplicationValue(current.data, input.bankScope)) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
}

export function requireApplicationReadCheckpoint(state: HindsightApplicationReplicaState, scope: HindsightApplicationScope,
  allowDeleted = false): HindsightApplicationReplicaCheckpoint {
  const value = readApplicationCheckpoint(state.db, scope.bankId);
  if (!value) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_MISSING");
  if (!sameApplicationValue(value.namespace, scope.namespace)) throw new Error("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
  assertApplicationAuthority(state, { ...scope, authorityEpochId: value.authorityEpochId, bankScope: value.bankScope });
  if (!sameApplicationValue(readReplicaCheckpoint(state.db, scope.bankId) ?? null, value.native)) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_UNPAIRED");
  if (value.bankDeleted && !allowDeleted) throw new Error("HINDSIGHT_APPLICATION_BANK_DELETED");
  return value;
}

export function buildApplicationSnapshotCheckpoint(state: HindsightApplicationReplicaState, input: HindsightApplicationSnapshotInput): HindsightApplicationReplicaCheckpoint {
  const manifest = input.bundle.manifest; const previous = input.expectedCheckpoint;
  const compatible = previous !== null && previous.authorityEpochId === input.authorityEpochId
    && sameApplicationValue(previous.namespace, input.namespace);
  const native = compatible ? input.expectedNativeCheckpoint : null;
  if (!compatible && !input.nativeBaseline) throw new Error("HINDSIGHT_APPLICATION_NATIVE_BASELINE_REQUIRED");
  if (compatible && !native) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_UNPAIRED");
  const at = state.now(); const baseline = input.nativeBaseline;
  const checkpoint = MemoryReplicaCheckpointSchema.parse({ bankId: input.bankId,
    providerLineageId: input.namespace.provider_lineage, bankGeneration: input.namespace.bank_generation,
    authorityEpochId: input.authorityEpochId, replicaEpochId: randomUUID(), endCursor: manifest.checkpoint.native_cursor,
    snapshotId: native?.snapshotId ?? baseline?.snapshotId,
    snapshotCursor: native?.snapshotCursor ?? baseline?.manifest.endCursor,
    snapshotManifestDigest: native?.snapshotManifestDigest ?? baseline?.manifest.manifestDigest,
    manifestDigest: state.records.applicationDigest(input), verifiedAt: at });
  return HindsightApplicationReplicaCheckpointSchema.parse({ namespace: input.namespace, bankId: input.bankId,
    authorityEpochId: input.authorityEpochId, bankScope: bankScope(input), checkpoint: manifest.checkpoint, native: checkpoint,
    snapshot: { id: manifest.snapshot_id, manifestHash: manifest.manifest_hash, checkpoint: manifest.checkpoint },
    publication: { kind: "snapshot", id: manifest.snapshot_id, hash: manifest.manifest_hash }, verifiedAt: at, bankDeleted: false });
}

export function buildApplicationEventCheckpoint(state: HindsightApplicationReplicaState, input: HindsightApplicationEventInput): HindsightApplicationReplicaCheckpoint {
  const previous = input.expectedCheckpoint; const manifest = input.event.manifest; const at = state.now();
  const native = MemoryReplicaCheckpointSchema.parse({ ...previous.native, endCursor: manifest.to_checkpoint.native_cursor,
    manifestDigest: state.records.applicationDigest(input), verifiedAt: at });
  return HindsightApplicationReplicaCheckpointSchema.parse({ ...previous, native, checkpoint: manifest.to_checkpoint,
    publication: { kind: "event", id: String(manifest.state_cursor), hash: manifest.event_hash },
    verifiedAt: at, bankDeleted: manifest.bank_deleted });
}

export function publishApplicationCheckpoint(state: HindsightApplicationReplicaState, input: {
  previous: HindsightApplicationReplicaCheckpoint | null; previousNative: MemoryReplicaCheckpoint | null;
  next: HindsightApplicationReplicaCheckpoint;
}): void {
  const value = HindsightApplicationReplicaCheckpointSchema.parse(input.next);
  publishReplicaCheckpoint(state.db, { previous: input.previousNative, next: value.native });
  const params = { bank: value.bankId, lineage: value.namespace.provider_lineage, generation: value.namespace.bank_generation,
    application: value.namespace.application_id, authority: value.authorityEpochId, native: value.checkpoint.native_cursor,
    state: value.checkpoint.state_cursor, json: JSON.stringify(value), hash: applicationCheckpointHash(value), deleted: value.bankDeleted ? 1 : 0 };
  if (input.previous === null) {
    state.db.prepare(`INSERT INTO hindsight_application_replica_checkpoints
      (bank_id,provider_lineage,bank_generation,application_id,authority_epoch_id,native_cursor,state_cursor,checkpoint_json,checkpoint_hash,bank_deleted)
      VALUES (:bank,:lineage,:generation,:application,:authority,:native,:state,:json,:hash,:deleted)`).run(params);
  } else {
    const changed = state.db.prepare(`UPDATE hindsight_application_replica_checkpoints SET provider_lineage=:lineage,
      bank_generation=:generation,application_id=:application,authority_epoch_id=:authority,native_cursor=:native,
      state_cursor=:state,checkpoint_json=:json,checkpoint_hash=:hash,bank_deleted=:deleted
      WHERE bank_id=:bank AND checkpoint_hash=:previous`).run({ ...params, previous: applicationCheckpointHash(input.previous) });
    if (changed.changes !== 1) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_STALE");
  }
}

export function bankScope(input: Pick<HindsightApplicationPublicationInput, "expectedBank" | "bankId">): MemoryBankScope {
  const bank = MemoryReplicaBankSchema.parse(input.expectedBank);
  if (bank.bankId !== input.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  return MemoryBankScopeSchema.parse({ kind: bank.scope, characterId: bank.characterId });
}
