/**
 * INPUT:  one Core SQLite writer, trusted Bank routing and verified native/application publications
 * OUTPUT: durable paired publication and lexical read snapshots over the same independently guarded readers
 * POS:    core/db — application-aware B5 composition; never activates authority or creates a native policy
 */
import { TakiApplicationTimeSchema } from "@taki/shared";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { createHindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { createReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import { readApplicationCheckpoint, requireApplicationReadCheckpoint } from "./hindsight-application-replica-checkpoint.ts";
import type { HindsightApplicationReplicaDeps, HindsightApplicationReplicaRepo,
  HindsightApplicationReplicaReader, HindsightApplicationReplicaState } from "./hindsight-application-replica-contract.ts";
import { applicationEvidenceAccess, latestApplicationArtifact, readApplicationArtifact, readApplicationBody } from "./hindsight-application-replica-evidence.ts";
import { readApplicationReplicaSnapshot } from "./hindsight-application-replica-read-snapshot.ts";
import { publishApplicationEvent, publishApplicationSnapshot } from "./hindsight-application-replica-publication.ts";
import { readApplicationCachedBodies, readApplicationCachedBody, saveApplicationCachedBodies } from "./hindsight-application-replica-cache.ts";
import { readApplicationBankBinding, readApplicationBindingWork, readApplicationBlockArtifacts, readApplicationLogicalRecord,
  readApplicationMemoryRecord, readApplicationNativeHead, readApplicationPinnedRecords,
  readApplicationSourceArtifacts, searchApplicationMemories } from "./hindsight-application-replica-query.ts";

export function createHindsightApplicationReplicaRepo(input: HindsightApplicationReplicaDeps): HindsightApplicationReplicaRepo {
  const now = () => TakiApplicationTimeSchema.parse(input.now?.() ?? new Date().toISOString());
  const state: HindsightApplicationReplicaState = { ...input, now,
    records: createReplicaRecordStore(input.db, input.tokenizer), leases: createHindsightReplicaLeaseRepo(input.db, now) };
  return {
    ...createReader(state),
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
    cachedBody: (value) => readApplicationCachedBody(state, value),
    cachedBodies: (value) => readApplicationCachedBodies(state, value),
    cacheBodies: (value) => saveApplicationCachedBodies(state, value),
  };
}

function createReader(state: HindsightApplicationReplicaState): HindsightApplicationReplicaReader {
  return {
    readSnapshot: (read) => readApplicationReplicaSnapshot(state, createReader, read),
    checkpoint: (bankId) => state.read ? state.read.checkpoint(bankId) : readApplicationCheckpoint(state.db, bankId),
    nativeCheckpoint: (bankId) => state.read ? state.read.checkpoint(bankId)?.native : readReplicaCheckpoint(state.db, bankId),
    nativeHead: (value) => readApplicationNativeHead(state, { ...value, object_kind: value.objectKind, object_id: value.objectId }),
    artifact: (value) => {
      requireApplicationReadCheckpoint(state, value, true);
      return state.read ? applicationEvidenceAccess(state, value).artifactOrUndefined(value.version) : readApplicationArtifact(state.db, value);
    },
    latestArtifact: (value) => {
      requireApplicationReadCheckpoint(state, value, true);
      return latestApplicationArtifact(state.db, value);
    },
    sourceArtifacts: (value) => readApplicationSourceArtifacts(state, value),
    blockArtifacts: (value) => readApplicationBlockArtifacts(state, value),
    body: (value) => {
      requireApplicationReadCheckpoint(state, value, true);
      return state.read ? applicationEvidenceAccess(state, value).bodyId(value.bodyId) : readApplicationBody(state.db, value);
    },
    bankBinding: (bankId) => readApplicationBankBinding(state, bankId),
    logicalRecord: (value) => readApplicationLogicalRecord(state, value),
    record: (value) => readApplicationMemoryRecord(state, value),
    search: (value) => searchApplicationMemories(state, value),
    pinned: (value) => readApplicationPinnedRecords(state, value),
    bindingWork: (value) => readApplicationBindingWork(state, { ...value, kind: "binding" }),
    duePolicyWork: (value) => readApplicationBindingWork(state, { ...value, kind: "assessment" }),
  };
}
