/**
 * INPUT:  a Core-minted backup id, the committed provider lineage, the native Bank ids and the Core terminal-operation ids
 * OUTPUT: HindsightNativeBackupRoute (native snapshot request -> native proof + artifact reference; read-back of a native-host
 *         ZIP digest) and createUnavailableHindsightBackupRoute() for a Core with no route wired
 * POS:    core/memory/hindsight-backup — capture step 5 seam (§6); the route never receives Core cursors, it reports native
 *         truth read in the same REPEATABLE READ transaction as its snapshot and the pair check judges it
 */
import type { HindsightBackupNativeProof, HindsightBackupNativeRequest } from "@taki/shared";

/** The same request body route b writes as `native-request.json`; the proof answers membership for exactly its operation ids. */
export type HindsightNativeBackupRequest = HindsightBackupNativeRequest & { signal: AbortSignal };

export interface HindsightNativeBackupSnapshot {
  proof: HindsightBackupNativeProof;
  /** The native ZIP stays on the native host (owner PR02): the endpoint returns its proof and digest, never its bytes. */
  artifact: { location: "native-host"; file: string };
  schema: string;
}

export interface HindsightNativeBackupRoute {
  /** False without a ready native connection; a route-c capture then fails before pausing anything (a disabled native
   *  endpoint is only discovered by the call and fails the same code after the pause). */
  available(): boolean;
  snapshot(request: HindsightNativeBackupRequest): Promise<HindsightNativeBackupSnapshot>;
  /** The native host's current digest of a native-host ZIP; null when the file is gone. */
  readBack(input: { file: string; signal: AbortSignal }): Promise<{ sha256: string; bytes: number } | null>;
}

/** Every route-c capture and native-host read-back fails ROUTE_UNAVAILABLE (route b still works). */
export function createUnavailableHindsightBackupRoute(): HindsightNativeBackupRoute {
  return {
    available: () => false,
    snapshot: () => Promise.reject(new Error("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE")),
    readBack: () => Promise.reject(new Error("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE")),
  };
}
