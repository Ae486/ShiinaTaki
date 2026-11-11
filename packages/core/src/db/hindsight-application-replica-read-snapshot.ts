/**
 * INPUT:  existing replica readers, current Bank routing and the sole Core SQLite connection
 * OUTPUT: a synchronous read-only snapshot with one pairing check per Bank and exact evidence reuse
 * POS:    core/db — lexical read owner only; no lease, write, Native dispatch or cross-await authorization
 */
import { sameApplicationValue, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { assertApplicationReadCheckpoint, readApplicationCheckpoint } from "./hindsight-application-replica-checkpoint.ts";
import { createApplicationEvidenceAccess } from "./hindsight-application-replica-evidence.ts";
import type { HindsightApplicationReplicaCheckpoint, HindsightApplicationReplicaReader,
  HindsightApplicationReplicaState } from "./hindsight-application-replica-contract.ts";

export function readApplicationReplicaSnapshot<T>(state: HindsightApplicationReplicaState,
  createReader: (state: HindsightApplicationReplicaState) => HindsightApplicationReplicaReader,
  read: (replica: HindsightApplicationReplicaReader) => T): T {
  if (state.read) { state.read.assertOpen(); return synchronous(read(createReader(state))); }
  let result!: T;
  state.db.transaction(() => {
    const snapshot = snapshotState(state);
    try {
      result = synchronous(read(createReader({ ...state, read: snapshot })));
    } finally { snapshot.close(); }
  });
  return result;
}

function synchronous<T>(result: T): T {
  if (result && typeof result === "object" && "then" in result) throw new Error("HINDSIGHT_APPLICATION_READ_SCOPE_ASYNC");
  return result;
}

function snapshotState(state: HindsightApplicationReplicaState) {
  let active = true;
  const checkpoints = new Map<string, HindsightApplicationReplicaCheckpoint | undefined>();
  const evidence = new Map<string, ReturnType<typeof createApplicationEvidenceAccess>>();
  const assertOpen = () => { if (!active) throw new Error("HINDSIGHT_APPLICATION_READ_SCOPE_CLOSED"); };
  const checkpoint = (bankId: string) => {
    assertOpen();
    if (!checkpoints.has(bankId)) {
      const value = readApplicationCheckpoint(state.db, bankId);
      if (value) assertApplicationReadCheckpoint(state, value);
      checkpoints.set(bankId, value);
    }
    return checkpoints.get(bankId);
  };
  return { checkpoint, assertOpen,
    evidence: (scope: HindsightApplicationScope) => {
      const value = checkpoint(scope.bankId);
      if (!value) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_MISSING");
      if (!sameApplicationValue(value.namespace, scope.namespace)) throw new Error("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
      let access = evidence.get(scope.bankId);
      if (!access) { access = createApplicationEvidenceAccess(state.db, scope); evidence.set(scope.bankId, access); }
      return access;
    },
    close: () => { active = false; checkpoints.clear(); evidence.clear(); } };
}
