/**
 * INPUT:  a programmable native state (lineage, per-Bank generation/cursors/application, known receipt ids)
 * OUTPUT: createNativeBackupRouteDouble() — an in-memory HindsightNativeBackupRoute answering the proof from that state at
 *         snapshot time, with an onSnapshot hook for inter-capture writes, failure injection and recorded requests
 * POS:    core/memory/hindsight-backup — test support; not in the production path
 */
import type { HindsightBackupNativeProof } from "@taki/shared";
import { hindsightBackupOperationDigest } from "./hindsight-backup-pair.ts";
import type { HindsightNativeBackupRequest, HindsightNativeBackupRoute, HindsightNativeBackupSnapshot } from "./hindsight-backup-route.ts";

export interface NativeBackupBankState {
  bankGeneration: string; currentCursor: number;
  application: { nativeCursor: number; stateCursor: number } | null;
}
export interface NativeBackupState {
  providerLineage: string;
  banks: Map<string, NativeBackupBankState>;
  receipts: Set<string>;
}
export interface NativeBackupRouteDouble extends HindsightNativeBackupRoute {
  state: NativeBackupState;
  requests: HindsightNativeBackupRequest[];
  /** Runs before the proof is read, i.e. after the Core copy: the inter-capture write window. */
  onSnapshot?: (request: HindsightNativeBackupRequest) => Promise<void> | void;
  /** When set, snapshot() yields this instead of a proof; "hang" never settles and ignores the signal. */
  fail?: Error | "hang" | { proof: unknown };
  unavailable: boolean;
}

export function createNativeBackupRouteDouble(state: NativeBackupState): NativeBackupRouteDouble {
  const double: NativeBackupRouteDouble = {
    state, requests: [], unavailable: false,
    available: () => !double.unavailable,
    snapshot: async (request) => {
      double.requests.push(request);
      await double.onSnapshot?.(request);
      if (double.fail === "hang") return new Promise<never>(() => undefined);
      if (double.fail instanceof Error) throw double.fail;
      const proof = double.fail ? double.fail.proof as HindsightBackupNativeProof : nativeProofOf(double.state, request);
      return { proof, artifact: { location: "native-host", file: `/var/lib/hindsight/backups/${request.backupId}.zip` }, schema: "public" } satisfies HindsightNativeBackupSnapshot;
    },
  };
  return double;
}

function nativeProofOf(state: NativeBackupState, request: HindsightNativeBackupRequest): HindsightBackupNativeProof {
  const ids = [...new Set(request.operationIds)];
  const missing = ids.filter((id) => !state.receipts.has(id)).sort();
  return {
    providerLineage: state.providerLineage, alembicRevision: "a1b2c3d4e5f6", upstreamCommit: "0123456789abcdef", compatibilityBuild: "taki-build",
    banks: request.nativeBankIds.flatMap((bankId) => {
      const bank = state.banks.get(bankId);
      return bank ? [{ bankId, bankGeneration: bank.bankGeneration, currentCursor: bank.currentCursor, minimumAvailableCursor: 0, application: bank.application }] : [];
    }),
    receipts: { count: ids.length, digest: hindsightBackupOperationDigest(ids), missingCount: missing.length, missingSample: missing.slice(0, 16) },
    zipSha256: "e".repeat(64), zipBytes: 4096,
  };
}
