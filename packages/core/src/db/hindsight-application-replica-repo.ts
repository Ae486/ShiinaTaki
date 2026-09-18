/**
 * INPUT:  one Core SQLite writer, trusted Bank routing and verified native/application publications
 * OUTPUT: createHindsightApplicationReplicaRepo — durable paired checkpoints, exact reads and policy work
 * POS:    core/db — application-aware B5 composition; never activates authority or creates a native policy
 */
import { TakiApplicationTimeSchema } from "@taki/shared";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { createReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import { readApplicationCheckpoint, requireApplicationReadCheckpoint } from "./hindsight-application-replica-checkpoint.ts";
import type { HindsightApplicationReplicaDeps, HindsightApplicationReplicaRepo,
  HindsightApplicationReplicaState } from "./hindsight-application-replica-contract.ts";
import { latestApplicationArtifact, readApplicationArtifact, readApplicationBody } from "./hindsight-application-replica-evidence.ts";
import { publishApplicationEvent, publishApplicationSnapshot } from "./hindsight-application-replica-publication.ts";
import { readApplicationCachedBody, saveApplicationCachedBodies } from "./hindsight-application-replica-cache.ts";
import { readApplicationBankBinding, readApplicationBindingWork, readApplicationBlockArtifacts, readApplicationLogicalRecord,
  readApplicationMemoryRecord, readApplicationNativeHead, readApplicationPinnedRecords,
  readApplicationSourceArtifacts, searchApplicationMemories } from "./hindsight-application-replica-query.ts";

export function createHindsightApplicationReplicaRepo(input: HindsightApplicationReplicaDeps): HindsightApplicationReplicaRepo {
  const now = () => TakiApplicationTimeSchema.parse(input.now?.() ?? new Date().toISOString());
  const state: HindsightApplicationReplicaState = { ...input, now,
    records: createReplicaRecordStore(input.db, input.tokenizer), leases: createHindsightReplicaLeaseRepo(input.db, now) };
  return {
    leases: state.leases,
    seedVerifiedSnapshot: (value) => {
      if (value.expectedCheckpoint !== null) throw new Error("HINDSIGHT_APPLICATION_ALREADY_SEEDED");
      return publishApplicationSnapshot(state, value);
    },
    reconcileVerifiedSnapshot: (value) => {
      if (value.expectedCheckpoint === null) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_MISSING");
      return publishApplicationSnapshot(state, value);
    },
    applyEvent: (value) => publishApplicationEvent(state, value),
    checkpoint: (bankId) => readApplicationCheckpoint(input.db, bankId),
    nativeCheckpoint: (bankId) => readReplicaCheckpoint(input.db, bankId),
    nativeHead: (value) => readApplicationNativeHead(state, { ...value, object_kind: value.objectKind, object_id: value.objectId }),
    artifact: (value) => {
      requireApplicationReadCheckpoint(state, value, true);
      return readApplicationArtifact(input.db, value);
    },
    latestArtifact: (value) => {
      requireApplicationReadCheckpoint(state, value, true);
      return latestApplicationArtifact(input.db, value);
    },
    sourceArtifacts: (value) => readApplicationSourceArtifacts(state, value),
    blockArtifacts: (value) => readApplicationBlockArtifacts(state, value),
    body: (value) => {
      requireApplicationReadCheckpoint(state, value, true);
      return readApplicationBody(input.db, value);
    },
    cachedBody: (value) => readApplicationCachedBody(state, value),
    cacheBodies: (value) => saveApplicationCachedBodies(state, value),
    bankBinding: (bankId) => readApplicationBankBinding(state, bankId),
    logicalRecord: (value) => readApplicationLogicalRecord(state, value),
    record: (value) => readApplicationMemoryRecord(state, value),
    search: (value) => searchApplicationMemories(state, value),
    pinned: (value) => readApplicationPinnedRecords(state, value),
    bindingWork: (value) => readApplicationBindingWork(state, { ...value, kind: "binding" }),
    duePolicyWork: (value) => readApplicationBindingWork(state, { ...value, kind: "assessment" }),
  };
}
