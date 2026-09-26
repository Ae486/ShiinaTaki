/**
 * INPUT:  a Core-minted backup id, the committed provider lineage, the native Bank ids and the Core terminal-operation ids
 * OUTPUT: HindsightNativeBackupRoute (native snapshot request -> native proof + artifact reference) and
 *         createUnavailableHindsightBackupRoute(), the production route until the native backup endpoint lands
 * POS:    core/memory/hindsight-backup — capture step 5 seam (§6); the route never receives Core cursors, it reports native
 *         truth read in the same REPEATABLE READ transaction as its snapshot and the pair check judges it
 */
import type { HindsightBackupNativeProof } from "@taki/shared";

export interface HindsightNativeBackupRequest {
  backupId: string;
  providerLineageId: string;
  nativeBankIds: readonly string[];
  /** The Core terminal-operation list; the proof answers membership for exactly this list. */
  operationIds: readonly string[];
  signal: AbortSignal;
}

export interface HindsightNativeBackupSnapshot {
  proof: HindsightBackupNativeProof;
  /** The native ZIP stays on the native host; a Core-held copy needs a store writer the native endpoint does not have yet. */
  artifact: { location: "native-host"; file: string };
  schema: string;
}

export interface HindsightNativeBackupRoute {
  /** False when no native backup endpoint is configured; capture then fails before pausing anything. */
  available(): boolean;
  snapshot(request: HindsightNativeBackupRequest): Promise<HindsightNativeBackupSnapshot>;
}

/** Deferred to W5 (owner PR02 answer pending): no native backup endpoint exists, so every capture fails ROUTE_UNAVAILABLE. */
export function createUnavailableHindsightBackupRoute(): HindsightNativeBackupRoute {
  return {
    available: () => false,
    snapshot: () => Promise.reject(new Error("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE")),
  };
}
